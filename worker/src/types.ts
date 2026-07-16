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

export interface ConversationState {
  guildId: string;
  channelId: string;
  messages: ChatMessage[];
  updatedAt: number;
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

export interface DiscordResponse {
  type: InteractionCallbackType;
  data?: {
    content?: string;
    flags?: number;
  };
}

export enum InteractionCallbackType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
}
