import type { MCPToolResult } from "./types";

export async function executeToolRemotely(
  toolName: string,
  args: Record<string, unknown>,
  bridgeUrl: string,
): Promise<string> {
  try {
    const response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({
        success: false,
        error: `MCP Bridge error (${response.status}): ${errorText}`,
      });
    }

    const result = (await response.json()) as MCPToolResult;
    if (!result.success) {
      return JSON.stringify({ success: false, error: result.error });
    }

    return JSON.stringify(result.result);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error calling MCP bridge",
    });
  }
}
