import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { AskRequest, AskResponse, WebAskRequest, WebResetRequest } from "./types.js";
import { runAsk, runAskForWeb } from "./ai-service.js";
import {
  deleteExpiredSessions,
  resetSession,
  ensureUser,
  getUsers,
  getUserSessions,
  renameWebSession,
  resetWebSession,
  getSystemPromptForUser,
  setSystemPromptForUser,
  getSessionMessages,
  resolveWebSessionId,
} from "./conversation-manager.js";
import { closeDb } from "./db.js";

const PORT = parseInt(process.env.PORT ?? "3210", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const BIND_HOST = process.env.BIND_HOST ?? HOST;
const OPENCODE_GO_API_KEY = process.env.OPENCODE_GO_API_KEY ?? "";
const OPENCODE_GO_BASE_URL = process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1";
const BRIDGE_URL = process.env.BRIDGE_URL ?? `http://127.0.0.1:${PORT}`;

async function main(): Promise<void> {
  console.log("ai-rotom MCP Bridge 起動中...");

  const client = new Client(
    { name: "ai-rotom-bridge", version: "0.1.0" },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@nonz250/ai-rotom"],
  });

  await client.connect(transport);
  console.log("ai-rotom MCP サーバーに接続しました");

  // 期限切れセッションの定期削除（10分ごと）
  const cleanupInterval = setInterval(() => {
    try {
      deleteExpiredSessions();
    } catch (error) {
      console.error("[cleanup] 期限切れセッション削除エラー:", error);
    }
  }, 10 * 60 * 1000);

  const server = createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // 静的ファイル配信
    if (method === "GET" && (url === "/" || url.startsWith("/public/"))) {
      serveStatic(url, res);
      return;
    }

    // ヘルスチェック
    if (method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // ツール一覧
    if (method === "GET" && url === "/tools") {
      try {
        const tools = await client.listTools();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result: tools }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: String(error) }));
      }
      return;
    }

    // ツール実行: POST /tools/:toolName
    const toolMatch = url.match(/^\/tools\/(.+)$/);
    if (method === "POST" && toolMatch) {
      await handleToolCall(toolMatch[1], req, res, client);
      return;
    }

    // AI 質問受付(Discord用): POST /ask
    if (method === "POST" && url === "/ask") {
      await handleDiscordAsk(req, res);
      return;
    }

    // 会話リセット(Discord用): POST /reset
    if (method === "POST" && url === "/reset") {
      await handleDiscordReset(req, res);
      return;
    }

    // Web用: ユーザー一覧
    if (method === "GET" && url === "/api/users") {
      try {
        const users = getUsers();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(users));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: ユーザー作成
    if (method === "POST" && url === "/api/users") {
      try {
        const body = await readBody(req);
        const { user_id, display_name } = JSON.parse(body);
        const user = ensureUser(user_id, display_name);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(user));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: プロンプト取得
    const promptGetMatch = url.match(/^\/api\/users\/(.+)\/prompt$/);
    if (method === "GET" && promptGetMatch) {
      try {
        const userId = promptGetMatch[1];
        const promptText = getSystemPromptForUser(userId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user_id: userId, prompt_text: promptText }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: プロンプト更新
    const promptPutMatch = url.match(/^\/api\/users\/(.+)\/prompt$/);
    if (method === "PUT" && promptPutMatch) {
      try {
        const userId = promptPutMatch[1];
        const body = await readBody(req);
        const { prompt_text } = JSON.parse(body);
        setSystemPromptForUser(userId, prompt_text ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: AI質問
    if (method === "POST" && url === "/api/web/ask") {
      await handleWebAsk(req, res);
      return;
    }

    // Web用: 会話リセット
    if (method === "POST" && url === "/api/web/reset") {
      await handleWebReset(req, res);
      return;
    }

    // Web用: セッション一覧
    if (method === "GET" && url.startsWith("/api/sessions?")) {
      await handleSessionList(url, res);
      return;
    }

    // Web用: セッション名変更 / メッセージ取得
    const sessionDetailMatch = url.match(/^\/api\/sessions\/([^/?]+)$/);
    if (sessionDetailMatch) {
      const sessionId = sessionDetailMatch[1];
      if (method === "PUT") {
        await handleSessionRename(sessionId, req, res);
        return;
      }
      if (method === "GET") {
        await handleSessionMessages(sessionId, res);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  });

  server.listen(PORT, BIND_HOST, () => {
    console.log(`MCP Bridge HTTP サーバー起動: http://${BIND_HOST}:${PORT}`);
    console.log(`エンドポイント:`);
    console.log(`  GET  /                    - WebチャットUI`);
    console.log(`  GET  /health              - ヘルスチェック`);
    console.log(`  GET  /tools               - ツール一覧`);
    console.log(`  POST /tools/:name          - ツール実行`);
    console.log(`  POST /ask                  - Discord用AI質問受付`);
    console.log(`  POST /reset                - Discord用会話リセット`);
    console.log(`  GET  /api/users            - Webユーザー一覧`);
    console.log(`  POST /api/users            - Webユーザー作成`);
    console.log(`  GET  /api/users/:id/prompt - プロンプト取得`);
    console.log(`  PUT  /api/users/:id/prompt - プロンプト更新`);
    console.log(`  POST /api/web/ask          - Web用AI質問`);
    console.log(`  POST /api/web/reset        - Web用会話リセット`);
    console.log(`  GET  /api/sessions?...     - セッション一覧`);
    console.log(`  PUT  /api/sessions/:id     - セッション名変更`);
    console.log(`  GET  /api/sessions/:id     - メッセージ履歴`);
  });

  const shutdown = async () => {
    console.log("\nシャットダウン中...");
    clearInterval(cleanupInterval);
    try { closeDb(); } catch { /* ignore */ }
    try { await client.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ========== ヘルパー関数 ==========

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", (err: Error) => reject(err));
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(url: string, res: ServerResponse): void {
  const publicDir = join(process.cwd(), "public");

  let filePath: string;
  if (url === "/") {
    filePath = join(publicDir, "index.html");
  } else {
    const relative = url.replace(/^\/public\//, "");
    if (relative.includes("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    filePath = join(publicDir, relative);
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("File not found");
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = readFileSync(filePath);

  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

async function handleToolCall(
  toolName: string,
  req: IncomingMessage,
  res: ServerResponse,
  client: Client,
): Promise<void> {
  try {
    const body = await readBody(req);
    const args = JSON.parse(body);

    console.log(`ツール実行: ${toolName}`, JSON.stringify(args).substring(0, 200));

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, result }));
  } catch (error) {
    console.error(`ツール実行エラー [${toolName}]:`, error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: String(error) }));
  }
}

async function handleDiscordAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const askRequest = JSON.parse(body) as AskRequest;

    if (!askRequest.userMessage || !askRequest.channelId || !askRequest.applicationId || !askRequest.interactionToken) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "必須フィールド不足: userMessage, channelId, applicationId, interactionToken",
      } satisfies AskResponse));
      return;
    }

    if (!OPENCODE_GO_API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "OPENCODE_GO_API_KEY が設定されていません" } satisfies AskResponse));
      return;
    }

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true } satisfies AskResponse));

    console.log(`[ask] 受付: channel=${askRequest.channelId} message="${askRequest.userMessage.substring(0, 50)}..."`);

    const result = await runAsk(askRequest.userMessage, {
      channelId: askRequest.channelId,
      guildId: askRequest.guildId,
      applicationId: askRequest.applicationId,
      interactionToken: askRequest.interactionToken,
      apiKey: OPENCODE_GO_API_KEY,
      baseUrl: OPENCODE_GO_BASE_URL,
      bridgeUrl: BRIDGE_URL,
    });

    if (!result.success) {
      console.error(`[ask] 処理失敗: ${result.error}`);
    }
  } catch (error) {
    console.error("[ask] リクエスト不正:", error);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: String(error) } satisfies AskResponse));
  }
}

async function handleDiscordReset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { channelId } = JSON.parse(body) as { channelId: string };
    if (!channelId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "channelId が必要です" }));
      return;
    }
    resetSession(channelId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: String(error) }));
  }
}

async function handleWebAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!OPENCODE_GO_API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OPENCODE_GO_API_KEY が設定されていません" }));
      return;
    }

    const body = await readBody(req);
    const webReq = JSON.parse(body) as WebAskRequest;

    if (!webReq.user_id || !webReq.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "必須フィールド不足: user_id, message" }));
      return;
    }

    ensureUser(webReq.user_id);

    console.log(`[web-ask] userId=${webReq.user_id} session=${webReq.session_id ?? "(新規)"} message="${webReq.message.substring(0, 50)}..."`);

    const result = await runAskForWeb(webReq.message, {
      userId: webReq.user_id,
      sessionId: webReq.session_id,
      apiKey: OPENCODE_GO_API_KEY,
      baseUrl: OPENCODE_GO_BASE_URL,
      bridgeUrl: BRIDGE_URL,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("[web-ask] エラー:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

async function handleWebReset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { user_id, session_id } = JSON.parse(body) as WebResetRequest;

    if (!user_id || !session_id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "必須フィールド不足: user_id, session_id" }));
      return;
    }

    resetWebSession(user_id, session_id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

async function handleSessionList(url: string, res: ServerResponse): Promise<void> {
  try {
    const params = new URLSearchParams(url.slice(url.indexOf("?")));
    const userId = params.get("user_id");

    if (!userId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "user_id クエリパラメータが必要です" }));
      return;
    }

    const sessions = getUserSessions(userId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

async function handleSessionRename(
  rawId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(req);
    const { name } = JSON.parse(body) as { name: string };

    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "name が必要です" }));
      return;
    }

    const sid = resolveWebSessionId(rawId);
    if (!sid) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "セッションが見つかりません" }));
      return;
    }

    renameWebSession(sid, name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

async function handleSessionMessages(rawId: string, res: ServerResponse): Promise<void> {
  try {
    const sid = resolveWebSessionId(rawId);
    if (!sid) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "セッションが見つかりません" }));
      return;
    }

    const messages = getSessionMessages(sid);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

main().catch((error) => {
  console.error("起動に失敗しました:", error);
  process.exit(1);
});
