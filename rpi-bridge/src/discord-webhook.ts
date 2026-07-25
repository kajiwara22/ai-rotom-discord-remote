const MAX_LENGTH = 1900;

function splitMessage(content: string): string[] {
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

export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const chunks = splitMessage(content);
  for (let i = 0; i < chunks.length; i++) {
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: i === 0 ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunks[i] }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      console.error(`[discord-webhook] PATCH失敗 (${response.status}): ${text}`);
      throw new Error(`Discord webhook error (${response.status}): ${text}`);
    }
  }
  console.log(`[discord-webhook] 応答編集完了 (${chunks.length} chunks)`);
}
