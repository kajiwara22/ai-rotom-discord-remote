export interface DiscordInteraction {
  type: InteractionType;
  id: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  token: string;
  data?: InteractionData;
  member?: { user: DiscordUser };
  user?: DiscordUser;
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
}

export interface InteractionData {
  name: string;
  options?: InteractionOption[];
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface DiscordUser {
  id: string;
  username: string;
}

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

export interface MCPToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

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

export interface ConversationSession {
  sessionId: string;
  channelId: string;
  guildId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  isActive: boolean;
}

export interface AskRequest {
  userMessage: string;
  channelId: string;
  guildId?: string;
  applicationId: string;
  interactionToken: string;
}

export interface AskResponse {
  success: boolean;
  error?: string;
}

// Web用型
export interface WebAskRequest {
  user_id: string;
  session_id?: string;
  message: string;
}

export interface WebAskResponse {
  session_id: string;
  reply: string;
}

export interface WebResetRequest {
  user_id: string;
  session_id: string;
}

export interface SessionInfo {
  session_id: string;
  user_id: string;
  session_name: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface UserInfo {
  user_id: string;
  display_name: string;
  created_at: number;
}

export interface SystemPromptInfo {
  user_id: string;
  prompt_text: string;
  updated_at: number;
}
