// Discord types
export interface DiscordInteraction {
  type: number;
  id: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  token: string;
  data?: {
    name: string;
    options?: Array<{ name: string; value: string }>;
  };
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
}

// Chat message types
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// OpenCode Go API response
export interface OpenCodeGoResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
}

// Session types
export interface ConversationSession {
  session_id: string;
  channel_id: string;
  guild_id?: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

// Request/Response types for /ask endpoint
export interface AskRequest {
  command: string;
  user_message: string;
  channel_id: string;
  application_id: string;
  token: string;
  timestamp: number;
}

export interface AskResponse {
  success: boolean;
  session_id?: string;
  error?: string;
}

// MCP Bridge response
export interface MCPToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
