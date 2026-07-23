import type { ProviderId, ApiKeys, OAuthCredential, ProviderConfig, ReasoningEffort, CustomProvider } from "@/lib/providers"
import type { McpServerConfig } from "@/lib/mcp"
import type { ModelMessage } from "ai"
import type { AgentCardPart, OrchestraConfig } from "@/lib/orchestra/types"
import type { Locale } from "@/lib/i18n/types"
import type { Appearance } from "@/lib/theme"
import type { TokenSaverSettings } from "@/lib/token-savers/types"
import type { MemorySettings } from "@/lib/memory-settings"
import type { PrivacySettings } from "@/lib/privacy"
import type { InferenceServerSettings } from "@/lib/inference-server"
import type { PermissionRule } from "@/lib/permission/types"
import type { AgentProvidersSettings, NativeAgentHandle } from "@/lib/agent-providers/types"
import type { SupervisorSettings } from "@/lib/agents/runtime"

export type Role = "user" | "assistant" | "system" | "tool"

// Image attached to a user message — stored as a base64 data URL so it can be
// fed straight to the AI SDK image part and to the thumbnail <img> render
// without a round-trip to disk. Large images are downscaled before storage
// (see src/lib/image.ts) to keep session payloads and token counts sane.
export type MessageImage = {
  id: string
  dataUrl?: string
  ref?: string
  mime: string
  name?: string
  width?: number
  height?: number
}

export type MessageFile = {
  id: string
  path: string
  name: string
  isDir: boolean
}

export type MessagePdf = {
  id: string
  ref: string
  mime: string // daima "application/pdf"
  name: string
  pages?: number
  size?: number
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: string
      isError?: boolean
    }
  | AgentCardPart

export type Message = {
  id: string
  role: Role
  content: string
  parts?: Part[]
  images?: MessageImage[]
  files?: MessageFile[]
  pdfs?: MessagePdf[]
  pending?: boolean
  localStats?: { tokPerSec: number; tokens: number; ttftMs: number }
  meta?: boolean
  compacting?: boolean
  snapshotBase?: string
  modelMsgCount?: number
  stopReason?: "length" | "halted"
}

// Per-category snapshot of what currently fills the context window. Powers the
// composer "Context Usage" popover (system prompt / tool defs / conversation).
// All values are estimated token counts; they sum to ~effectiveContextTokens
// (tools are sent alongside the prompt but counted separately here).
export type ContextBreakdown = {
  system: number
  tools: number
  conversation: number
}

export type SessionUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  lastInputTokens?: number
  effectiveContextTokens?: number
  contextBreakdown?: ContextBreakdown
  costUsd: number
  turns: number
}

export type AutoCompactSettings = {
  enabled: boolean
  triggerPct: number
  targetPct: number
  model?: string
  keepLast: number
}

// Local in-process LLM profile.
export type LocalLlmSettings = {
  // Persistent chat context window (tokens). Rust auto-picks the KV cache type
  // from this, and compaction/fill gauges use the effective window.
  contextWindow: number
  // Flash attention policy ("enabled" | "auto" | "disabled").
  flashAttention: "enabled" | "auto" | "disabled"
  // Prompt prefill batch size. Larger values reduce llama_decode calls for long
  // prompts; Rust clamps this to a safe range.
  batchSize: number
  // Decode threads. 0 means Rust auto-selects a bounded value for the machine.
  threads: number
  // Prefill/batch threads. 0 means Rust auto-selects a bounded value.
  batchThreads: number
  // Speculative decoding engine. "off" is current stable path; "mtp" is wired
  // as an explicit opt-in while the engine loop lands.
  speculativeMode: "off" | "mtp"
  // Maximum draft tokens per target verification step.
  draftTokens: number
  // Optional MTP GGUF basename/path. Empty means discover `mtp-*` sibling.
  draftModel: string
  // Agent mode gives the model tools + multi-step loop. Off means single-turn chat.
  agentMode: boolean
}

export type AgentMode = "build" | "plan" | "orchestra"
export type DelegationMode = "inherit" | "solo" | "adaptive"

export type SddStage = "requirement" | "design" | "prototype" | "plan" | "build" | "verify"

export type SddDraft = {
  id: string
  title: string
  stage: SddStage
  workspacePath: string
  assistantSessionId?: string
  createdAt: number
  updatedAt: number
}

// Persistent goal — `/goal` slash komutuyla set edilir. Aktifken her assistant
// harness goal'i temizler.
export type SessionGoal = {
  text: string
  iter: number
  maxIter: number
  createdAt: number
  paused?: boolean
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoPriority = "high" | "medium" | "low"
export type TodoItem = { content: string; status: TodoStatus; priority?: TodoPriority }

export type SideChatMessage = {
  role: "user" | "assistant"
  content: string
  reasoning?: string
  pending?: boolean
}
export type SideChatThread = {
  id: string
  createdAt: number
  contextBoundary: number
  messages: SideChatMessage[]
}

export type Session = {
  id: string
  title: string
  updatedAt: number
  messages: Message[]
  modelMessages?: ModelMessage[]
  provider: ProviderId
  model: string
  workspacePath?: string
  // data blob'a otomatik persist olur (sessionToRow rest).
  workspaceReadOnly?: boolean
  forkParentId?: string
  openFiles?: string[]
  activeFile?: string | null
  previewFile?: string | null
  usage?: SessionUsage
  mode?: AgentMode
  delegationMode?: DelegationMode
  orchestra?: OrchestraConfig
  goal?: SessionGoal
  todos?: TodoItem[]
  reasoningEffort?: ReasoningEffort
  nativeAgent?: NativeAgentHandle
  permission?: PermissionRule[]
  pinned?: boolean
  unread?: boolean
  // ad. Bir agent `send_to_session(to:"cto", …)` ile bu session'a ping atabilir.
  handle?: string
  archived?: boolean
  routineId?: string
  sideChats?: SideChatThread[]
  // Timestamp (ms) of the user's most recent message — drives sidebar ordering
  // and the per-row time. Falls back to updatedAt when absent (legacy sessions).
  // Persisted via the data blob (sessionToRow rest).
  lastUserMessageAt?: number
}

export type ApprovalDecision = "allow" | "deny"

export type ApprovalRuleAction = ApprovalDecision | "ask"

export type ApprovalReply = "once" | "always" | "deny"

export type ApprovalRule = {
  tool: string
  pattern?: string
  decision: ApprovalRuleAction
  scope?: "session" | "persistent"
}

export type ApprovalMode = "ask" | "auto-review" | "bypass"

// Hook lifecycle event'leri.
export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "SubagentStart" | "SubagentStop" | "PreCompact" | "PermissionRequest"

export type HookConfig = {
  id: string
  event: HookEvent
  matcher?: string
  command: string
  timeoutMs?: number
  blocking?: boolean
  enabled?: boolean
  description?: string
  pluginId?: string
}

export type SemanticIndexConfig = {
  enabled: boolean
  provider: "openai" | "ollama" | "custom"
  baseUrl?: string
  model: string
  apiKey?: string
  topK?: number
  autoContext?: boolean
}

export type ToolOutputSettings = {
  maxLines?: number
  maxBytes?: number
}

export type WebSearchConfig = {
  provider: "tavily" | "brave" | "exa" | "duckduckgo"
  apiKey?: string
}

export type FirecrawlConfig = {
  apiKey?: string
}

// Image generation wire protocol — how the request/response is shaped.
//  - openai-image: POST {baseUrl}/images/generations, response data[].b64_json|url
//    (OpenAI gpt-image + any OpenAI-compatible endpoint: zenmux, OpenRouter, …)
//  - minimax-image: POST {baseUrl}/v1/image_generation, response data.image_urls[]
export type ImageGenerationProtocol = "openai-image" | "minimax-image"

// Image generation config — enables the `generate_image` tool. Two sourcing modes:
//  - Preset: providerId points at a configured chat provider (e.g. "openai") and
//    we reuse its API key + base URL. protocol is inferred from the provider.
//  - Custom: providerId is "custom" (or empty) and the user supplies baseUrl +
//    apiKey + protocol directly (any OpenAI-compatible / MiniMax image endpoint).
// The API key, when custom, is a secret → stored in the OS keychain, never on disk
// (mirrors webSearch/firecrawl). The tool is hidden from the model unless enabled
// and a usable key resolves.
export type ImageGenerationConfig = {
  enabled: boolean
  // "openai" | "gemini" | "minimax" → named preset (protocol + base derived);
  // "" / "custom" → custom OpenAI-compatible endpoint (baseUrl + apiKey below).
  providerId: string
  // Base URL — prefilled from the preset, overridable (proxy / region). For custom
  // mode this is the only source. protocol is no longer stored: it is derived from
  // providerId at resolve time (preset.protocol, else openai-image for custom).
  baseUrl?: string
  apiKey?: string
  // Model name sent to the service (e.g. "gpt-image-1", "image-01").
  model: string
  // Optional default "WxH" or "auto"; used when the model doesn't specify a size.
  defaultSize?: string
  // Per-request timeout (ms). Hi-res generation can take minutes. Default 180000.
  timeoutMs?: number
}

export type CachedProviderCatalog = {
  data: Record<string, unknown>
  fetchedAt: number
}

export type Settings = {
  // JSON Schema reference for editor autocomplete when settings.json is hand-
  // edited. Points at the sidecar schema written next to settings.json in
  // AppData (see storage.ensureSettingsSchemaSidecar). Not a real setting.
  $schema?: string
  apiKeys: ApiKeys
  defaultProvider: ProviderId
  defaultModel: string
  theme: "light" | "dark" | "system"
  fontScale?: "s" | "m" | "l" | "xl"
  // UI language — i18n locale code. Falls back to DEFAULT_LOCALE if unset.
  language?: Locale
  defaultWorkspacePath?: string
  defaultAgent?: string
  bashTimeoutMs?: number
  sessionSpendCapUsd?: number
  commitAttribution?: boolean
  cleanupPeriodDays?: number
  approvalMode: ApprovalMode
  approvalRules: ApprovalRule[]
  permission?: PermissionRule[]
  // MCP HTTP/SSE sunucu konfigleri
  mcpServers: McpServerConfig[]
  autoCompact: AutoCompactSettings
  // Yerel in-process LLM VARSAYILAN profili (context penceresi, flash attention,
  localLlm?: LocalLlmSettings
  localLlmByModel?: Record<string, LocalLlmSettings>
  webSearch?: WebSearchConfig
  firecrawl?: FirecrawlConfig
  // Optional image generation — enables the generate_image tool when configured.
  imageGeneration?: ImageGenerationConfig
  providerCatalog?: CachedProviderCatalog
  hooks?: HookConfig[]
  semantic?: SemanticIndexConfig
  // Theme/typography/UX flags — managed by the Appearance settings tab.
  // Optional for back-compat: old settings files fall back to DEFAULT_APPEARANCE
  // and the legacy `theme` field is migrated into `appearance.mode` on load.
  appearance?: Appearance
  // Token-saver toggles — three independent features (brief mode, compact
  // shell output, code map). Optional for back-compat with older settings files.
  tokenSavers?: TokenSaverSettings
  memory?: MemorySettings
  privacy?: PrivacySettings
  inferenceServer?: InferenceServerSettings
  // OAuth + extended provider credentials (token, refresh, expiry).
  // Plain apiKeys[] continues to hold simple API key strings.
  credentials?: Partial<Record<ProviderId, OAuthCredential>>
  // Per-provider config — baseURL, headers, custom options (openai-compatible
  // endpoint, azure deployment id, vertex project, etc.).
  providerConfigs?: Partial<Record<ProviderId, ProviderConfig>>
  // Native CLI agent providers (Codex/Claude). These are separate from API
  // providers because auth, session handles, and streaming come from the CLIs.
  agentProviders?: AgentProvidersSettings
  supervisor: SupervisorSettings
  customProviders?: CustomProvider[]
  // Fallback to shell env vars when apiKeys is empty. When false, auth chain
  // skips the env step. UI surfaces an "Env" badge when an env var is present.
  envFallback?: boolean
  // Per-model enable/disable map. Disabled models are filtered from `modelsFor()`
  // and hidden from the composer dropdown. Default: every recommended model is
  // enabled, others disabled.
  modelStatus?: Partial<Record<ProviderId, Record<string, boolean>>>
  reasoningEffort?: ReasoningEffort
  reasoningEffortByModel?: Record<string, ReasoningEffort>
  // Codezal terminal compact prompt (ZDOTDIR override). When true, terminal
  // spawns with a short prompt (`~ %`) without touching the user's ~/.zshrc.
  // Default: true.
  terminalShortPrompt?: boolean
  // spawn edilir. Default: true.
  terminalRestore?: boolean
  openFilesPanelOnLaunch?: boolean
  autoLintOnEdit?: boolean
  // Pre-write security scan — when on, write_file/edit_file content is scanned
  // for leaked credentials and risky patterns before it touches disk. Critical
  // (credential-grade) findings escalate to the approval modal even in
  // bypass/auto-review mode. Default on. See src/lib/security/scan.ts.
  securityScan?: boolean
  // Should the model write short progress notes between tool calls (fluid flow)?
  // When off, it works silently and reports at the end. Default on.
  narrateProgress?: boolean
  // Beta crash/feedback reporting. When on, swallowed app errors (render-boundary
  // crashes, genuine unhandled rejections) are POSTed to the website report
  // endpoint as anonymous email (message + stack + version + os/arch only — never
  // session content). User-initiated feedback is always sent regardless. Default on.
  crashReporting?: boolean
  // One-shot flag: the first-launch beta notice ("anonymous crash reports are
  // sent, toggle off in Settings") has been shown. Set true after it is dismissed.
  feedbackNoticeSeen?: boolean
  // One-shot flag: has the user finished (or skipped) the first-launch onboarding?
  // false → the Onboarding overlay shows on launch; set true on finish/skip.
  // Existing installs are migrated to true (see migrate.ts v2) so they never see it.
  onboardingCompleted?: boolean
  forkSubagent?: boolean
  // Vim keybindings in the message composer (NORMAL/INSERT modes). Default off.
  vimMode?: boolean
  // Post-run next-task suggestions: when a run finishes, a cheap model proposes
  // 3-4 repo-grounded next steps in the right panel (Ara-style). Default on.
  suggestionsEnabled?: boolean
  toolOutput?: ToolOutputSettings
  // Auto-check for app updates on launch (Tauri updater). Default on.
  autoUpdate?: boolean
  disabledSkills?: string[]
  // edilebilir. Default: "respond".
  monitorAction?: "respond" | "chat" | "notify"
  autopilot?: {
    runInBackground?: boolean
    autostart?: boolean
    keepAwake?: boolean
  }
  // On-disk schema version — drives versioned migrations on load
  // (see src/lib/config/migrate.ts). Absent in files written before versioning.
  schemaVersion?: number
}

export type SessionMeta = Pick<
  Session,
  "id" | "title" | "updatedAt" | "workspacePath" | "pinned" | "unread" | "archived" | "forkParentId" | "routineId" | "handle" | "lastUserMessageAt"
>

export type ProjectMeta = {
  name?: string
  color?: string
  defaultProvider?: ProviderId
  defaultModel?: string
}
