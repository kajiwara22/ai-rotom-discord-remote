import { InteractionType } from "./types";
import { verifySignature, jsonResponse, deferredResponse, editOriginalResponse, pingResponse } from "./discord";
import { ConversationSession } from "./conversation-do";

export { ConversationSession };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // スラッシュコマンド登録用
    if (url.pathname === "/register" && request.method === "POST") {
      return handleRegisterCommands(request, env);
    }

    // Discord Interactions
    if (url.pathname === "/interactions") {
      return handleInteraction(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const publicKey = env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const isValid = await verifySignature(request, publicKey);
  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const interaction = await request.json() as {
    type: number;
    id: string;
    application_id: string;
    token: string;
    channel_id?: string;
    data?: { name: string; options?: Array<{ name: string; value: string }> };
  };

  if (interaction.type === InteractionType.PING) {
    return jsonResponse(pingResponse());
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const channelId = interaction.channel_id ?? "dm";

    // 許可チャンネルチェック
    const allowedChannels = env.ALLOWED_CHANNEL_IDS?.split(",").map((c) => c.trim()).filter(Boolean) ?? [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      return jsonResponse({
        type: 4,
        data: { content: "このチャンネルでは使用できません。", flags: 64 },
      });
    }

    if (commandName === "ask") {
      const userMessage = interaction.data?.options?.find((o) => o.name === "message")?.value ?? "";

      // DO スタブを取得
      const doId = env.CONVERSATION_SESSION.idFromName(`channel:${channelId}`);
      const session = env.CONVERSATION_SESSION.get(doId);

      // 非同期処理を DO に委譲
      ctx.waitUntil(
        session.ask(
          userMessage,
          env.OPENCODE_GO_API_KEY,
          env.OPENCODE_GO_BASE_URL,
          env.MCP_BRIDGE_URL,
          interaction.application_id,
          interaction.token,
        ),
      );

      return jsonResponse(deferredResponse());
    }

    if (commandName === "reset") {
      const doId = env.CONVERSATION_SESSION.idFromName(`channel:${channelId}`);
      const session = env.CONVERSATION_SESSION.get(doId);
      ctx.waitUntil(session.reset());

      return jsonResponse({
        type: 4,
        data: { content: "会話をリセットしました。", flags: 64 },
      });
    }
  }

  return jsonResponse({ type: 4, data: { content: "不明なコマンドです。", flags: 64 } });
}

async function handleRegisterCommands(request: Request, env: Env): Promise<Response> {
  const { DISCORD_APPLICATION_ID, DISCORD_TOKEN } = env;
  if (!DISCORD_APPLICATION_ID || !DISCORD_TOKEN) {
    return new Response("DISCORD_APPLICATION_ID and DISCORD_TOKEN required", { status: 500 });
  }

  const commands = [
    {
      name: "ask",
      description: "ポケモン対戦の質問をAIに聞く（会話を継続できます）",
      options: [
        {
          name: "message",
          description: "質問内容",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "reset",
      description: "会話の履歴をリセットする",
    },
  ];

  const response = await fetch(
    `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${DISCORD_TOKEN}`,
      },
      body: JSON.stringify(commands),
    },
  );

  return jsonResponse(await response.json());
}

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_TOKEN: string;
  OPENCODE_GO_API_KEY: string;
  OPENCODE_GO_BASE_URL: string;
  MCP_BRIDGE_URL: string;
  ALLOWED_CHANNEL_IDS?: string;
  CONVERSATION_SESSION: DurableObjectNamespace<ConversationSession>;
}
