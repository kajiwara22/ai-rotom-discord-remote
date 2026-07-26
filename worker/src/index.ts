import { InteractionType } from "./types";
import { verifySignature, jsonResponse, deferredResponse, pingResponse } from "./discord";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      return handleRegisterCommands(request, env);
    }

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
    guild_id?: string;
    data?: { name: string; options?: Array<{ name: string; value: string }> };
  };

  if (interaction.type === InteractionType.PING) {
    return jsonResponse(pingResponse());
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const channelId = interaction.channel_id ?? "dm";

    const allowedChannels = env.ALLOWED_CHANNEL_IDS?.split(",").map((c) => c.trim()).filter(Boolean) ?? [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      return jsonResponse({
        type: 4,
        data: { content: "このチャンネルでは使用できません。", flags: 64 },
      });
    }

    if (commandName === "ask") {
      const userMessage = interaction.data?.options?.find((o) => o.name === "message")?.value ?? "";
      if (!userMessage) {
        return jsonResponse({
          type: 4,
          data: { content: "質問内容を入力してください。", flags: 64 },
        });
      }

      const piUrl = env.PI_BRIDGE_URL;
      if (!piUrl) {
        return jsonResponse({
          type: 4,
          data: { content: "サーバー設定エラー: PI_BRIDGE_URL が設定されていません。", flags: 64 },
        });
      }

      console.log(`[worker] /ask 受信: channel=${channelId} message="${userMessage.substring(0, 80)}"`);

      ctx.waitUntil(
        (async () => {
          try {
            const targetUrl = `${piUrl}/ask`;
            console.log(`[worker] Pi へ転送: ${targetUrl}`);
            const res = await fetch(targetUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
                "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
              },
              body: JSON.stringify({
                userMessage,
                channelId,
                guildId: interaction.guild_id ?? null,
                applicationId: interaction.application_id,
                interactionToken: interaction.token,
              }),
            });
            console.log(`[worker] Pi 応答: status=${res.status}`);
            if (!res.ok) {
              const body = await res.text();
              console.error(`[worker] Pi エラー応答: ${body.substring(0, 500)}`);
            }
          } catch (err) {
            console.error("[worker] Pi への転送失敗:", err);
          }
        })(),
      );

      return jsonResponse(deferredResponse());
    }

    if (commandName === "reset") {
      const piUrl = env.PI_BRIDGE_URL;
      if (piUrl) {
        ctx.waitUntil(
          fetch(`${piUrl}/reset`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
              "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
            },
            body: JSON.stringify({ channelId }),
          }).catch((err) => {
            console.error("[worker] Pi へのリセット転送失敗:", err);
          }),
        );
      }

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
  PI_BRIDGE_URL: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  ALLOWED_CHANNEL_IDS?: string;
}
