// ログへの時刻付与。他モジュールより先に効かせたいので import の先頭に置く
import "./log-timestamp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AskRequest,
  AskResponse,
  ChatMessage,
  WebAskRequest,
  WebAskResponse,
  WebResetRequest,
} from "./types.js";
import { extractQuiz, renderStoredReply } from "./quiz-block.js";
import { runAsk, runAskForWeb } from "./ai-service.js";
import {
  deleteExpiredSessions,
  resetSession,
  ensureUser,
  getUsers,
  updateUser,
  deleteUser,
  countUsers,
  getUserSessions,
  renameWebSession,
  resetWebSession,
  deleteWebSession,
  getStoredSystemPrompt,
  setSystemPromptForUser,
  getSessionMessages,
  resolveWebSessionId,
  isParentPinSet,
  setParentPin,
  verifyParentPin,
} from "./conversation-manager.js";
import { closeDb } from "./db.js";
import {
  isMatchTool,
  executeMatchTool,
  closeMatchRepository,
} from "./match-repository.js";
import { isTheoryTool, executeTheoryTool } from "./theory-import.js";

const PORT = parseInt(process.env.PORT ?? "3210", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const BIND_HOST = process.env.BIND_HOST ?? HOST;
const OPENCODE_GO_API_KEY = process.env.OPENCODE_GO_API_KEY ?? "";
const OPENCODE_GO_BASE_URL = process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1";
const BRIDGE_URL = process.env.BRIDGE_URL ?? `http://127.0.0.1:${PORT}`;
/** PIN 未設定時に使う初期 PIN。初回起動後に設定画面から変更できる */
const DEFAULT_PARENT_PIN = process.env.PARENT_PIN ?? "1234";

// ========== 保護者セッション（メモリ保持） ==========
const PARENT_TOKEN_TTL_MS = 30 * 60 * 1000;
const parentTokens = new Map<string, number>();

function issueParentToken(): string {
  const token = randomUUID();
  parentTokens.set(token, Date.now() + PARENT_TOKEN_TTL_MS);
  return token;
}

function isValidParentToken(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = parentTokens.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    parentTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * 保護者専用エンドポイントのガード。
 * 認証されていなければ 401 を返して true を返す（呼び出し側は即 return する）。
 */
function rejectIfNotParent(req: IncomingMessage, res: ServerResponse): boolean {
  const token = req.headers["x-parent-token"];
  if (isValidParentToken(Array.isArray(token) ? token[0] : token)) {
    return false;
  }
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "保護者認証が必要です" }));
  return true;
}

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
        const { user_id, display_name, avatar, mode } = JSON.parse(body);
        const user = ensureUser(user_id, display_name, avatar, mode);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(user));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // 保護者用: PIN の設定状況
    if (method === "GET" && url === "/api/parent/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pin_set: isParentPinSet() }));
      return;
    }

    // 保護者用: PIN 認証 → トークン発行
    if (method === "POST" && url === "/api/parent/verify") {
      try {
        const body = await readBody(req);
        const { pin } = JSON.parse(body) as { pin?: string };

        // 未設定なら初回起動時の既定 PIN を登録しておく
        if (!isParentPinSet()) {
          setParentPin(DEFAULT_PARENT_PIN);
        }

        if (!pin || !verifyParentPin(pin)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "暗証番号が違います" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: issueParentToken(), expires_in: PARENT_TOKEN_TTL_MS }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // 保護者用: PIN 変更（認証済みのみ）
    if (method === "PUT" && url === "/api/parent/pin") {
      if (rejectIfNotParent(req, res)) return;
      try {
        const body = await readBody(req);
        const { pin } = JSON.parse(body) as { pin?: string };
        if (!pin || !/^\d{4}$/.test(pin)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "暗証番号は数字4桁で指定してください" }));
          return;
        }
        setParentPin(pin);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // ユーザー情報更新
    // アバターだけの変更は見た目のみなので子ども自身が行える（PIN不要）。
    // 表示名・モードは保護者による設定なので認証を必須にする。
    const userPatchMatch = url.match(/^\/api\/users\/([^/?]+)$/);
    if (method === "PATCH" && userPatchMatch) {
      try {
        const userId = decodeURIComponent(userPatchMatch[1]);
        const body = await readBody(req);
        const { display_name, avatar, mode } = JSON.parse(body);

        const needsParent = display_name !== undefined || mode !== undefined;
        if (needsParent && rejectIfNotParent(req, res)) return;

        const user = updateUser(userId, { display_name, avatar, mode });
        if (!user) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "ユーザーが見つかりません" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(user));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // 保護者用: ユーザー削除（会話履歴もまとめて消える）
    if (method === "DELETE" && userPatchMatch) {
      if (rejectIfNotParent(req, res)) return;
      try {
        const userId = decodeURIComponent(userPatchMatch[1]);

        // 全員消してしまうと誰も使えなくなるため最後の1人は残す
        if (countUsers() <= 1) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "最後のユーザーは削除できません" }));
          return;
        }

        if (!deleteUser(userId)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "ユーザーが見つかりません" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: プロンプト取得
    const promptGetMatch = url.match(/^\/api\/users\/(.+)\/prompt$/);
    if (method === "GET" && promptGetMatch) {
      try {
        const userId = promptGetMatch[1];
        // 編集用なのでモード指示を含まない保存内容を返す
        const promptText = getStoredSystemPrompt(userId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user_id: userId, prompt_text: promptText }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // Web用: プロンプト更新（保護者認証が必要）
    const promptPutMatch = url.match(/^\/api\/users\/(.+)\/prompt$/);
    if (method === "PUT" && promptPutMatch) {
      if (rejectIfNotParent(req, res)) return;
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

    // Web用: セッション名変更 / メッセージ取得 / 削除
    const sessionDetailMatch = url.match(/^\/api\/sessions\/([^/?]+)/);
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
      if (method === "DELETE") {
        await handleSessionDelete(sessionId, url, res);
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
    console.log(`  GET    /api/users            - Webユーザー一覧`);
    console.log(`  POST   /api/users            - Webユーザー作成`);
    console.log(`  PATCH  /api/users/:id        - ユーザー更新（名前/モードは保護者認証）`);
    console.log(`  DELETE /api/users/:id        - ユーザー削除（保護者認証）`);
    console.log(`  GET    /api/users/:id/prompt - プロンプト取得`);
    console.log(`  PUT    /api/users/:id/prompt - プロンプト更新（保護者認証）`);
    console.log(`  GET    /api/parent/status    - PIN 設定状況`);
    console.log(`  POST   /api/parent/verify    - PIN 認証`);
    console.log(`  PUT    /api/parent/pin       - PIN 変更（保護者認証）`);
    console.log(`  POST   /api/web/ask          - Web用AI質問`);
    console.log(`  POST   /api/web/reset        - Web用会話リセット`);
    console.log(`  GET    /api/sessions?...     - セッション一覧`);
    console.log(`  PUT    /api/sessions/:id     - セッション名変更`);
    console.log(`  GET    /api/sessions/:id     - メッセージ履歴`);
    console.log(`  DELETE /api/sessions/:id     - セッション削除`);
  });

  const shutdown = async () => {
    console.log("\nシャットダウン中...");
    clearInterval(cleanupInterval);
    try { closeDb(); } catch { /* ignore */ }
    try { await closeMatchRepository(); } catch { /* ignore */ }
    try { await client.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ========== ヘルパー関数 ==========

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Parent-Token");
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
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
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

  const headers: Record<string, string> = { "Content-Type": contentType };
  // HTML/CSS/JS はキャッシュさせない。更新がスマホに反映されない（古い画面のまま）のを防ぐ。
  // 画像はボリュームがあるため対象外。
  if (ext === ".html" || ext === ".css" || ext === ".js") {
    headers["Cache-Control"] = "no-cache";
  }

  res.writeHead(200, headers);
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

    // 対戦記録は MCP ではなく Pi 側の Parquet 参照で処理する（ADR-0010）。
    // 応答は MCP と同じ形にそろえ、呼び出し側の分岐を増やさない
    if (isMatchTool(toolName)) {
      const text = await executeMatchTool(toolName, args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: { content: [{ type: "text", text }] },
        }),
      );
      return;
    }

    // 育成論の取り込み（ADR-0013）。同じく bridge 側で処理する
    if (isTheoryTool(toolName)) {
      const text = await executeTheoryTool(toolName, args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: { content: [{ type: "text", text }] },
        }),
      );
      return;
    }

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

/**
 * 内部の camelCase を Web API の snake_case へ揃える。
 *
 * 他の Web API はすべて snake_case であり、クライアントと `WebAskResponse` も
 * `session_id` を前提にしている。ここを素通しすると `session_id` が届かず、
 * 新しいセッション ID がクライアントに渡らないため会話が継続しない。
 */
function toWebAskResponse(result: { sessionId: string; reply: string }): WebAskResponse {
  // クイズの構造は API 境界で本文から切り離す（ADR-0011）。
  // DB には抽出前の原文が残るため、AI は自分が出した問題を覚えたままでいられる
  const { text, quiz } = extractQuiz(result.reply);
  if (!quiz) return { session_id: result.sessionId, reply: text };
  return { session_id: result.sessionId, reply: text, quiz };
}

/**
 * SSE でイベントを送る関数を作る。
 * クライアントが切断した後の書き込みは無視する（処理自体は止めない）。
 */
function createEventSender(res: ServerResponse): (event: string, data: unknown) => void {
  return (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

async function handleWebAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Accept ヘッダーで SSE と従来の JSON を切り替える。
  // curl などからの単発呼び出しは JSON のまま使える
  const wantsSse = String(req.headers.accept ?? "").includes("text/event-stream");

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

    console.log(`[web-ask] userId=${webReq.user_id} session=${webReq.session_id ?? "(新規)"} sse=${wantsSse} message="${webReq.message.substring(0, 50)}..."`);

    if (!wantsSse) {
      const result = await runAskForWeb(webReq.message, {
        userId: webReq.user_id,
        sessionId: webReq.session_id,
        apiKey: OPENCODE_GO_API_KEY,
        baseUrl: OPENCODE_GO_BASE_URL,
        bridgeUrl: BRIDGE_URL,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(toWebAskResponse(result)));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });
    const send = createEventSender(res);

    // クライアントが離れても処理は続ける（ADR-0008）。
    // 途中で殺すと未完のツール往復が残るうえ、既に払ったコストも捨てることになる。
    //
    // req の "close" はボディを読み終えた時点で発火済みのため使えない。
    // res の "close" が end() より前に来たものだけが本当の切断である。
    res.on("close", () => {
      if (!res.writableEnded) {
        console.log(`[web-ask] クライアント切断（処理は継続）: userId=${webReq.user_id}`);
      }
    });

    try {
      const result = await runAskForWeb(webReq.message, {
        userId: webReq.user_id,
        sessionId: webReq.session_id,
        apiKey: OPENCODE_GO_API_KEY,
        baseUrl: OPENCODE_GO_BASE_URL,
        bridgeUrl: BRIDGE_URL,
        onProgress: (progress) => send("tool", progress),
      });
      send("done", toWebAskResponse(result));
    } catch (error) {
      console.error("[web-ask] エラー:", error);
      send("error", { error: String(error) });
    }
    res.end();
  } catch (error) {
    console.error("[web-ask] エラー:", error);
    if (res.headersSent) {
      createEventSender(res)("error", { error: String(error) });
      res.end();
      return;
    }
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

/** セッション削除: DELETE /api/sessions/:id?user_id=xxx */
async function handleSessionDelete(
  rawId: string,
  url: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const queryIndex = url.indexOf("?");
    const params = new URLSearchParams(queryIndex >= 0 ? url.slice(queryIndex) : "");
    const userId = params.get("user_id");

    if (!userId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "user_id クエリパラメータが必要です" }));
      return;
    }

    const deleted = deleteWebSession(userId, rawId);
    if (!deleted) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "セッションが見つかりません" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
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

/** 履歴として返す前に、クイズの構造ブロックを読める形へ置き換える（ADR-0011） */
function renderStoredMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant" || !message.content) return message;
  return { ...message, content: renderStoredReply(message.content) };
}

async function handleSessionMessages(rawId: string, res: ServerResponse): Promise<void> {
  try {
    const sid = resolveWebSessionId(rawId);
    if (!sid) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "セッションが見つかりません" }));
      return;
    }

    const messages = getSessionMessages(sid).map(renderStoredMessage);
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
