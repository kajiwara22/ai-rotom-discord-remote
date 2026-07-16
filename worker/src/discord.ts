import nacl from "tweetnacl";
import type { DiscordInteraction, DiscordResponse, InteractionCallbackType } from "./types";

export async function verifySignature(
  request: Request,
  publicKey: string,
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;

  const body = await request.clone().text();
  const isValid = nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + body),
    hexToUint8Array(signature),
    hexToUint8Array(publicKey),
  );
  return isValid;
}

function hexToUint8Array(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}

export function jsonResponse(
  data: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function deferredResponse(): DiscordResponse {
  return {
    type: 5 as InteractionCallbackType, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  };
}

export function contentResponse(content: string, ephemeral = false): DiscordResponse {
  return {
    type: 4 as InteractionCallbackType,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
    },
  };
}

export function pingResponse(): DiscordResponse {
  return { type: 1 };
}

export async function sendFollowup(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const formData = new FormData();
  // Discord のメッセージは最大2000文字なので、分割が必要
  const chunks = splitMessage(content);
  for (const chunk of chunks) {
    await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      },
    );
  }
}

export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const chunks = splitMessage(content);
  for (let i = 0; i < chunks.length; i++) {
    await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: i === 0 ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunks[i] }),
      },
    );
  }
}

function splitMessage(content: string): string[] {
  const MAX_LENGTH = 1900;
  if (content.length <= MAX_LENGTH) return [content];

  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
      splitAt = MAX_LENGTH;
    }
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  return chunks;
}
