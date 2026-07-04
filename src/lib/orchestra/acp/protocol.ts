// session/cancel (client→agent) + session/update, session/request_permission (agent→client).

// --- JSON-RPC zarf tipleri ---
export type JsonRpcId = number | string

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}
export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}
export type JsonRpcError = { code: number; message: string; data?: unknown }
export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export const ACP_METHOD = {
  initialize: "initialize",
  newSession: "session/new",
  prompt: "session/prompt",
  cancel: "session/cancel",
  authenticate: "authenticate",
  setModel: "session/set_model",
  // agent→client
  sessionUpdate: "session/update",
  requestPermission: "session/request_permission",
  readTextFile: "fs/read_text_file",
  writeTextFile: "fs/write_text_file",
} as const

export const ACP_PROTOCOL_VERSION = 1

// --- initialize ---
export type InitializeParams = {
  protocolVersion: number
  clientCapabilities?: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean }
  }
}
export type InitializeResult = {
  protocolVersion: number
  agentCapabilities?: unknown
  authMethods?: unknown[]
}

// --- session/new ---
export type NewSessionParams = {
  cwd: string
  mcpServers: unknown[]
}
export type AcpModelOption = { modelId: string; name: string }
export type NewSessionResult = {
  sessionId: string
  models?: {
    currentModelId?: string
    availableModels?: AcpModelOption[]
  }
}

export type SetModelParams = { sessionId: string; modelId: string }

export type TextContentBlock = { type: "text"; text: string }
export type ContentBlock = TextContentBlock

// --- session/prompt ---
export type PromptParams = {
  sessionId: string
  prompt: ContentBlock[]
}
export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
export type PromptResult = { stopReason: StopReason }

// --- session/cancel (notification) ---
export type CancelParams = { sessionId: string }

// --- session/update (agent→client notification) ---
// (her property `unknown` olur).
export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content?: { type?: string; text?: string } }
  | { sessionUpdate: "agent_thought_chunk"; content?: { type?: string; text?: string } }
  | { sessionUpdate: "tool_call"; toolCallId?: string; title?: string; kind?: string; status?: string }
  | { sessionUpdate: "tool_call_update"; toolCallId?: string; status?: string }
  | {
      sessionUpdate: "usage_update"
      inputTokens?: number
      outputTokens?: number
      promptTokens?: number
      completionTokens?: number
    }
export type SessionUpdateParams = {
  sessionId: string
  update: SessionUpdate
}

// --- session/request_permission (agent→client request) ---
export type PermissionOption = {
  optionId: string
  // opencode: allow_once | allow_always | reject_once (optionId: once|always|reject)
  kind?: "allow_once" | "allow_always" | "reject_once" | "reject_always" | (string & {})
  name?: string
}
export type RequestPermissionParams = {
  sessionId: string
  toolCall?: {
    toolCallId?: string
    title?: string
    kind?: string
    rawInput?: unknown
  }
  options: PermissionOption[]
}
export type PermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" }
export type RequestPermissionResult = { outcome: PermissionOutcome }
