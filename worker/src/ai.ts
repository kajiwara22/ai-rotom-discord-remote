import type { ChatMessage, ToolCall, ToolDefinition, OpenCodeGoResponse } from "./types";

const MODEL = "deepseek-v4-pro";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
): Promise<{ content: string | null; toolCalls: ToolCall[]; finishReason: string }> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenCode Go API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as OpenCodeGoResponse;
  const choice = data.choices[0];
  const message = choice.message;

  return {
    content: message.content,
    toolCalls: message.tool_calls ?? [],
    finishReason: choice.finish_reason,
  };
}

export async function executeToolCallLoop(
  initialMessages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...initialMessages];
  let loop = 0;
  const maxLoops = 15; // 最大ツール呼び出し回数

  while (loop < maxLoops) {
    const { content, toolCalls, finishReason } = await chatCompletion(
      messages,
      tools,
      apiKey,
      baseUrl,
    );

    if (finishReason === "stop") {
      if (content) {
        messages.push({ role: "assistant", content });
      }
      return messages;
    }

    if (toolCalls.length === 0) {
      if (content) {
        messages.push({ role: "assistant", content });
      }
      return messages;
    }

    // アシスタントの応答を追加
    messages.push({
      role: "assistant",
      content: content,
      tool_calls: toolCalls,
    });

    // 各ツールを実行
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      const result = await executeTool(functionName, functionArgs);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    loop++;
  }

  return messages;
}
