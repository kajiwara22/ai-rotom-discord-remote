import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";

const PORT = parseInt(process.env.PORT ?? "3210", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
// Cloudflare Tunnel からのアクセスを許可する場合は HOST を 0.0.0.0 に
const BIND_HOST = process.env.BIND_HOST ?? HOST;

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

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  });

  server.listen(PORT, BIND_HOST, () => {
    console.log(`MCP Bridge HTTP サーバー起動: http://${BIND_HOST}:${PORT}`);
  });

  // シグナルハンドリング
  process.on("SIGINT", async () => {
    console.log("\nシャットダウン中...");
    await client.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    console.log("\nシャットダウン中...");
    await client.close();
    process.exit(0);
  });
}

function readBody(req: Parameters<Parameters<typeof createServer>[0]>[0]): Promise<string> {
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
