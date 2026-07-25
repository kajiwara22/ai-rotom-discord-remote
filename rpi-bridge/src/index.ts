import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage } from "node:http";
import type { AskRequest, AskResponse } from "./types.js";
import { runAsk } from "./ai-service.js";
import { deleteExpiredSessions, resetSession } from "./conversation-manager.js";
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
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ヘルスチェック
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // ツール一覧
    if (req.method === "GET" && req.url === "/tools") {
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
    const toolMatch = req.url?.match(/^\/tools\/(.+)$/);
    if (req.method === "POST" && toolMatch) {
      const toolName = toolMatch[1];
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
      return;
    }

    // AI 質問受付: POST /ask
    if (req.method === "POST" && req.url === "/ask") {
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

        // 即座に受理応答を返す（Worker のタイムアウト対策）
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true } satisfies AskResponse));

        // 非同期で AI 処理を実行
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
        return;
      } catch (error) {
        console.error("[ask] リクエスト不正:", error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: String(error) } satisfies AskResponse));
        return;
      }
    }

    // 会話リセット: POST /reset
    if (req.method === "POST" && req.url === "/reset") {
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
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  });

  server.listen(PORT, BIND_HOST, () => {
    console.log(`MCP Bridge HTTP サーバー起動: http://${BIND_HOST}:${PORT}`);
    console.log(`エンドポイント:`);
    console.log(`  GET  /health     - ヘルスチェック`);
    console.log(`  GET  /tools      - ツール一覧`);
    console.log(`  POST /tools/:name - ツール実行`);
    console.log(`  POST /ask        - AI 質問受付`);
    console.log(`  POST /reset      - 会話リセット`);
  });

  // シグナルハンドリング
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", (err: Error) => reject(err));
  });
}

main().catch((error) => {
  console.error("起動に失敗しました:", error);
  process.exit(1);
});
