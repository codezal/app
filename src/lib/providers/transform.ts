// Provider transforms — message + request-option tweaks that real coding
// agents apply so models behave correctly. Ported and trimmed from OpenCode's
// provider/transform.ts to Codezal's Vercel AI SDK v6 surface.
//
// All functions are PURE (no I/O) so they are unit-testable in the node test
// env. Integration happens in App.tsx (messages + providerOptions) and in the
// fetch wrappers (schema sanitize).
//
// Five concerns:
//   1. applyCaching       — prompt-cache breakpoints (Anthropic/Bedrock/OpenRouter)
//   2. normalizeMessages  — surrogate scrub, toolCallId scrub, empty-part filter
//   3. reasoningOptions    — effort tier → provider-native thinking/reasoning opts
//   4. sanitizeToolSchema  — Gemini/Moonshot JSON-schema fixes (fetch-body level)
//   5. buildProviderOptions — compose reasoning + promptCacheKey for streamText
import type { ModelMessage } from "ai"
import type { ProviderId, ReasoningEffort } from "./types"

// ----- Provider family detection ---------------------------------------

function isAnthropicFamily(providerId: ProviderId, modelId: string): boolean {
  return providerId === "anthropic" || /claude|anthropic/i.test(modelId)
}
function isBedrock(providerId: ProviderId): boolean {
  return providerId === "amazon-bedrock"
}
function isMistralFamily(providerId: ProviderId, modelId: string): boolean {
  return providerId === "mistral" || /mistral|devstral/i.test(modelId)
}
function isClaude(providerId: ProviderId, modelId: string): boolean {
  return providerId === "anthropic" || /claude/i.test(modelId)
}
function isGemini(providerId: ProviderId, modelId: string): boolean {
  return providerId === "google" || providerId === "google-vertex" || /gemini/i.test(modelId)
}
function isMoonshot(providerId: ProviderId, modelId: string): boolean {
  return /moonshot|kimi/i.test(providerId) || /kimi/i.test(modelId)
}
function isOpenAIFamily(providerId: ProviderId): boolean {
  return providerId === "openai" || providerId === "azure"
}

// ----- 1 + 3. Surrogate + toolCallId + empty-part normalization --------

// Replace lone UTF-16 surrogate halves with U+FFFD. Truncated streams can leave
// unpaired surrogates that crash JSON.stringify on the next request.
export function sanitizeSurrogates(content: string): string {
  return content.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "�",
  )
}

type AnyPart = Record<string, unknown> & { type?: string }

function sanitizePartText(part: AnyPart): AnyPart {
  if (part.type === "text" && typeof part.text === "string") {
    return { ...part, text: sanitizeSurrogates(part.text) }
  }
  if (part.type === "reasoning" && typeof part.text === "string") {
    return { ...part, text: sanitizeSurrogates(part.text) }
  }
  if (part.type === "tool-result" && part.output && typeof part.output === "object") {
    const out = part.output as Record<string, unknown>
    if ((out.type === "text" || out.type === "error-text") && typeof out.value === "string") {
      return { ...part, output: { ...out, value: sanitizeSurrogates(out.value) } }
    }
  }
  return part
}

// Sanitize every text-bearing field in a message (immutable copy).
function sanitizeMessage(msg: ModelMessage): ModelMessage {
  if (typeof msg.content === "string") {
    return { ...msg, content: sanitizeSurrogates(msg.content) } as ModelMessage
  }
  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((p) => sanitizePartText(p as AnyPart)),
    } as ModelMessage
  }
  return msg
}

// Claude requires toolCallId matching ^[a-zA-Z0-9_-]+$ ; Mistral wants 9-char
// alphanumeric. Mismatched ids 400 the request. Scrub call + result the SAME
// way so they still pair up.
function scrubClaudeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
function scrubMistralId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 9).padEnd(9, "0")
}

function scrubToolCallIds(msg: ModelMessage, scrub: (id: string) => string): ModelMessage {
  if (!Array.isArray(msg.content)) return msg
  if (msg.role !== "assistant" && msg.role !== "tool") return msg
  return {
    ...msg,
    content: msg.content.map((p) => {
      const part = p as AnyPart
      if (
        (part.type === "tool-call" || part.type === "tool-result") &&
        typeof part.toolCallId === "string"
      ) {
        return { ...part, toolCallId: scrub(part.toolCallId) }
      }
      return part
    }),
  } as ModelMessage
}

// Anthropic/Bedrock reject empty-content messages and empty text/reasoning
// parts. Drop them; drop the whole message if nothing meaningful remains.
function filterEmptyParts(msgs: ModelMessage[], signatureKey: "anthropic" | "bedrock"): ModelMessage[] {
  return msgs
    .map((msg): ModelMessage | undefined => {
      if (typeof msg.content === "string") {
        return msg.content === "" ? undefined : msg
      }
      if (!Array.isArray(msg.content)) return msg
      const filtered = msg.content.filter((p) => {
        const part = p as AnyPart
        if (part.type === "text") return typeof part.text === "string" && part.text !== ""
        if (part.type === "reasoning") {
          const opts = part.providerOptions as Record<string, Record<string, unknown>> | undefined
          const sig = opts?.[signatureKey]
          return (
            (typeof part.text === "string" && part.text.trim().length > 0) ||
            sig?.signature != null ||
            sig?.redactedData != null
          )
        }
        return true
      })
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered } as ModelMessage
    })
    .filter((m): m is ModelMessage => m !== undefined)
}

// Full message normalization for a given provider/model.
export function normalizeMessages(
  msgs: ModelMessage[],
  providerId: ProviderId,
  modelId: string,
): ModelMessage[] {
  let out = msgs.map(sanitizeMessage)
  if (isClaude(providerId, modelId)) out = out.map((m) => scrubToolCallIds(m, scrubClaudeId))
  if (isMistralFamily(providerId, modelId)) out = out.map((m) => scrubToolCallIds(m, scrubMistralId))
  if (isAnthropicFamily(providerId, modelId) || isBedrock(providerId)) {
    out = filterEmptyParts(out, isBedrock(providerId) ? "bedrock" : "anthropic")
  }
  return out
}

// ----- 2. Prompt caching ------------------------------------------------

// Providers that need an explicit cache breakpoint. OpenAI/Azure cache
// automatically server-side, so they are intentionally excluded.
const CACHE_PROVIDERS = new Set<ProviderId>(["anthropic", "amazon-bedrock", "openrouter"])

function supportsCaching(providerId: ProviderId, modelId: string): boolean {
  if (CACHE_PROVIDERS.has(providerId)) return true
  // Anthropic models routed through other gateways still support it.
  return isAnthropicFamily(providerId, modelId) && providerId !== "google-vertex"
}

function cacheProviderOptions(providerId: ProviderId): Record<string, Record<string, unknown>> {
  if (providerId === "amazon-bedrock") return { bedrock: { cachePoint: { type: "default" } } }
  if (providerId === "openrouter") return { openrouter: { cacheControl: { type: "ephemeral" } } }
  return { anthropic: { cacheControl: { type: "ephemeral" } } }
}

function mergeOpts(
  a: Record<string, unknown> | undefined,
  b: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(a ?? {}) }
  for (const [k, v] of Object.entries(b)) {
    out[k] = { ...((out[k] as Record<string, unknown>) ?? {}), ...v }
  }
  return out
}

function markCache(
  msg: ModelMessage,
  opts: Record<string, Record<string, unknown>>,
  messageLevel: boolean,
): ModelMessage {
  if (messageLevel || !Array.isArray(msg.content) || msg.content.length === 0) {
    return { ...msg, providerOptions: mergeOpts(msg.providerOptions, opts) } as ModelMessage
  }
  // Content-level: stamp the last part (OpenRouter prefix caching).
  const content = (msg.content as AnyPart[]).slice()
  const last = content[content.length - 1] as AnyPart
  const t = last?.type
  if (last && typeof last === "object" && t !== "tool-approval-request" && t !== "tool-approval-response") {
    content[content.length - 1] = {
      ...last,
      providerOptions: mergeOpts(last.providerOptions as Record<string, unknown> | undefined, opts),
    }
    return { ...msg, content } as ModelMessage
  }
  return { ...msg, providerOptions: mergeOpts(msg.providerOptions, opts) } as ModelMessage
}

// Stamp cache breakpoints on the first 2 system messages + last 2 non-system
// messages. Anthropic caches the longest matching prefix, so a breakpoint near
// the end caches system + tools + history up to it.
export function applyCaching(
  msgs: ModelMessage[],
  providerId: ProviderId,
  modelId: string,
): ModelMessage[] {
  if (!supportsCaching(providerId, modelId)) return msgs
  const opts = cacheProviderOptions(CACHE_PROVIDERS.has(providerId) ? providerId : "anthropic")
  const messageLevel = providerId === "anthropic" || providerId === "amazon-bedrock"
  const systems = msgs.filter((m) => m.role === "system").slice(0, 2)
  const finals = msgs.filter((m) => m.role !== "system").slice(-2)
  const targets = new Set<ModelMessage>([...systems, ...finals])
  return msgs.map((m) => (targets.has(m) ? markCache(m, opts, messageLevel) : m))
}

function stripImageParts(msgs: ModelMessage[]): ModelMessage[] {
  return msgs.map((m) => {
    if (!Array.isArray(m.content)) return m
    let changed = false
    const content = m.content.map((p) => {
      const part = p as AnyPart
      const isImage = part.type === "image"
      const isImageFile =
        part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/")
      if (isImage || isImageFile) {
        changed = true
        return { type: "text", text: "[görsel kaldırıldı — model görsel girdisi desteklemiyor]" }
      }
      return part
    })
    return changed ? ({ ...m, content } as ModelMessage) : m
  })
}

// Convenience: full history transform (normalize then cache) for the stream.
export function transformHistory(
  msgs: ModelMessage[],
  providerId: ProviderId,
  modelId: string,
  acceptsImages = true,
): ModelMessage[] {
  const base = acceptsImages ? msgs : stripImageParts(msgs)
  return applyCaching(normalizeMessages(base, providerId, modelId), providerId, modelId)
}

// ----- 4. Reasoning effort → provider options ---------------------------

// Which effort tiers a model exposes for USER SELECTION. [] = no selector
// (model reasons by default or can't reason). OpenCode parity: generic
// openai-compatible upstreams expose tiers only for OpenAI-style model ids;
// purpose-built thinking models (Kimi, GLM/coding-plan upstreams) reason by
// default with no selectable level, so they get no tiers.
export function reasoningEfforts(
  providerId: ProviderId,
  modelId: string,
  reasoningCapable: boolean,
): ReasoningEffort[] {
  if (!reasoningCapable) return []
  const FULL: ReasoningEffort[] = ["off", "low", "medium", "high", "max"]
  if (isAnthropicFamily(providerId, modelId) || (isBedrock(providerId) && /claude|anthropic/i.test(modelId)))
    return FULL
  if (isOpenAIFamily(providerId)) return FULL
  if (isGemini(providerId, modelId)) return FULL
  if (providerId === "openrouter") return FULL
  if (providerId === "deepseek" || /deepseek/i.test(modelId)) return FULL
  if (providerId === "xai" || /grok/i.test(modelId)) return ["off", "low", "high"]
  // Generic OpenAI-compatible: only OpenAI-style ids expose reasoning_effort.
  if (/(^|[^a-z])gpt|^o[1-9]/i.test(modelId)) return FULL
  return []
}

export function defaultReasoningEffort(
  providerId: ProviderId,
  modelId: string,
  reasoningCapable: boolean,
): ReasoningEffort | undefined {
  const tiers = reasoningEfforts(providerId, modelId, reasoningCapable)
  if (tiers.length === 0) return undefined
  return tiers.includes("high") ? "high" : tiers[tiers.length - 1]
}

export function resolveReasoningEffort(args: {
  providerId: ProviderId
  modelId: string
  reasoningCapable: boolean
  sessionEffort?: ReasoningEffort
  byModel?: Record<string, ReasoningEffort>
}): ReasoningEffort {
  const { providerId, modelId, reasoningCapable, sessionEffort, byModel } = args
  if (sessionEffort) return sessionEffort
  const remembered = byModel?.[`${providerId}/${modelId}`]
  if (remembered) return remembered
  return defaultReasoningEffort(providerId, modelId, reasoningCapable) ?? "medium"
}

// Maps a single user-chosen effort tier to the active provider's native
// reasoning control. Returns {} when the model can't reason or effort is unset.
export function reasoningOptions(args: {
  providerId: ProviderId
  modelId: string
  effort: ReasoningEffort | undefined
  reasoningCapable: boolean
  outputLimit?: number
}): Record<string, unknown> {
  const { providerId, modelId, effort, reasoningCapable, outputLimit } = args
  if (!reasoningCapable || !effort) return {}
  // Only emit options for tiers the model actually exposes (OpenCode parity):
  // reason-by-default models (Kimi, coding-plan upstreams) have no tiers → {}.
  if (!reasoningEfforts(providerId, modelId, reasoningCapable).includes(effort)) return {}

  // Anthropic thinking budgets (also on Bedrock-hosted Claude).
  if (isAnthropicFamily(providerId, modelId) || (isBedrock(providerId) && /claude|anthropic/i.test(modelId))) {
    if (effort === "off") return {}
    // Keep room for the answer: thinking budget never eats the whole output
    // window (Anthropic requires max_tokens > budget_tokens).
    const out = outputLimit || 32_000
    const budget = {
      low: 4_000,
      medium: 8_000,
      high: Math.min(16_000, Math.max(2_000, Math.floor(out / 2) - 1)),
      max: Math.min(31_999, Math.max(4_000, Math.floor((out * 3) / 4))),
    }[effort]
    if (isBedrock(providerId)) {
      return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
    }
    return { thinking: { type: "enabled", budgetTokens: budget } }
  }

  // OpenAI / Azure reasoning_effort tiers.
  if (isOpenAIFamily(providerId)) {
    const eff = { off: "minimal", low: "low", medium: "medium", high: "high", max: "high" }[effort]
    return { reasoningEffort: eff, reasoningSummary: "auto" }
  }

  // Google thinking config.
  if (isGemini(providerId, modelId)) {
    if (effort === "off") return { thinkingConfig: { thinkingBudget: 0 } }
    const budget = { low: 4_000, medium: 8_000, high: 16_000, max: 24_576 }[effort]
    return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
  }

  // OpenRouter unified reasoning.
  if (providerId === "openrouter") {
    if (effort === "off") return { reasoning: { enabled: false } }
    const eff = { low: "low", medium: "medium", high: "high", max: "high" }[effort]
    return { reasoning: { effort: eff } }
  }

  // Generic OpenAI-compatible upstreams.
  if (effort === "off") return {}
  const eff = { low: "low", medium: "medium", high: "high", max: "high" }[effort]
  return { reasoningEffort: eff }
}

// providerOptions key the AI SDK reads for each provider. openai-compatible
// adapters use the provider name (= the catalog id) as the key.
function optionsKey(providerId: ProviderId): string {
  switch (providerId) {
    case "anthropic":
      return "anthropic"
    case "openai":
    case "azure":
      return "openai"
    case "google":
    case "google-vertex":
      return "google"
    case "openrouter":
      return "openrouter"
    case "amazon-bedrock":
      return "bedrock"
    default:
      return providerId
  }
}

// ----- 5. buildProviderOptions for streamText ---------------------------

// Compose reasoning options + prompt-cache routing key into the providerOptions
// object passed to streamText.
export function buildProviderOptions(args: {
  providerId: ProviderId
  modelId: string
  sessionId?: string
  effort: ReasoningEffort | undefined
  reasoningCapable: boolean
  outputLimit?: number
}): Record<string, Record<string, unknown>> {
  const { providerId, modelId, sessionId, effort, reasoningCapable, outputLimit } = args
  const out: Record<string, Record<string, unknown>> = {}

  const reasoning = reasoningOptions({ providerId, modelId, effort, reasoningCapable, outputLimit })
  if (Object.keys(reasoning).length > 0) {
    const key = optionsKey(providerId)
    out[key] = { ...(out[key] ?? {}), ...reasoning }
  }

  if (sessionId) {
    if (isOpenAIFamily(providerId)) {
      out.openai = { ...(out.openai ?? {}), promptCacheKey: sessionId }
    } else if (providerId === "openrouter") {
      out.openrouter = { ...(out.openrouter ?? {}), prompt_cache_key: sessionId }
    }
  }

  return out
}

// Cap output tokens like OpenCode (default 32k or the model's own limit).
export const OUTPUT_TOKEN_MAX = 32_000
export function maxOutputTokens(outputLimit?: number, cap = OUTPUT_TOKEN_MAX): number {
  return Math.min(outputLimit || cap, cap) || cap
}

// ----- 5. Tool-schema sanitization (Gemini / Moonshot) ------------------

type JsonObj = Record<string, unknown>
function isObj(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// Gemini rejects integer enums, tuple `items`, and properties/required on
// non-object nodes. Recursively coerce a JSON schema into a shape it accepts.
function sanitizeGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeGemini)
  if (!isObj(node)) return node

  const result: JsonObj = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === "enum" && Array.isArray(value)) {
      result[key] = value.map((v) => String(v))
      if (result.type === "integer" || result.type === "number") result.type = "string"
    } else if (isObj(value) || Array.isArray(value)) {
      result[key] = sanitizeGemini(value)
    } else {
      result[key] = value
    }
  }

  const hasCombiner = Array.isArray(result.anyOf) || Array.isArray(result.oneOf) || Array.isArray(result.allOf)

  if (result.type === "object" && isObj(result.properties) && Array.isArray(result.required)) {
    const props = result.properties as JsonObj
    result.required = (result.required as unknown[]).filter((f) => typeof f === "string" && f in props)
  }
  if (result.type === "array" && !hasCombiner) {
    if (result.items == null) result.items = {}
    if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
  }
  if (result.type && result.type !== "object" && !hasCombiner) {
    delete result.properties
    delete result.required
  }
  return result
}

// Moonshot/Kimi expand $ref before validation and reject sibling keywords;
// MFJS also requires a single `items` schema, not a tuple.
function sanitizeMoonshot(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeMoonshot)
  if (!isObj(node)) return node
  if ("$ref" in node && typeof node.$ref === "string") return { $ref: node.$ref }
  const result: JsonObj = {}
  for (const [key, value] of Object.entries(node)) result[key] = sanitizeMoonshot(value)
  if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
  return result
}

// Walk a request body and sanitize every tool parameter schema in place.
// Handles both Gemini (functionDeclarations[].parameters) and OpenAI-shaped
// (tools[].function.parameters) bodies. Defensive: unknown shapes pass through.
export function sanitizeToolSchema(providerId: ProviderId, modelId: string, body: unknown): unknown {
  if (!isObj(body)) return body
  const gemini = isGemini(providerId, modelId)
  const moonshot = isMoonshot(providerId, modelId)
  if (!gemini && !moonshot) return body
  const fix = gemini ? sanitizeGemini : sanitizeMoonshot

  // Gemini shape: tools[].functionDeclarations[].parameters + responseSchema.
  if (gemini && Array.isArray(body.tools)) {
    for (const tool of body.tools as unknown[]) {
      if (!isObj(tool) || !Array.isArray(tool.functionDeclarations)) continue
      for (const fd of tool.functionDeclarations as unknown[]) {
        if (isObj(fd) && fd.parameters != null) fd.parameters = fix(fd.parameters)
      }
    }
    const gen = body.generationConfig
    if (isObj(gen)) {
      if (gen.responseSchema != null) gen.responseSchema = fix(gen.responseSchema)
      if (gen.responseJsonSchema != null) gen.responseJsonSchema = fix(gen.responseJsonSchema)
    }
  }

  // OpenAI-shaped (Moonshot/Kimi via openai-compatible): tools[].function.parameters.
  if (moonshot && Array.isArray(body.tools)) {
    for (const tool of body.tools as unknown[]) {
      if (isObj(tool) && isObj(tool.function) && tool.function.parameters != null) {
        tool.function.parameters = fix(tool.function.parameters)
      }
    }
    const rf = body.response_format
    if (isObj(rf) && isObj(rf.json_schema) && rf.json_schema.schema != null) {
      rf.json_schema.schema = fix(rf.json_schema.schema)
    }
  }

  return body
}

// Fetch wrapper that sanitizes tool schemas in the outgoing JSON body. Returns
// the base fetch untouched when the provider needs no sanitization.
export function withSchemaSanitize(
  baseFetch: typeof fetch,
  providerId: ProviderId,
  modelId: string,
): typeof fetch {
  if (!isGemini(providerId, modelId) && !isMoonshot(providerId, modelId)) return baseFetch
  return (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as unknown
        init = { ...init, body: JSON.stringify(sanitizeToolSchema(providerId, modelId, parsed)) }
      } catch {
        // Non-JSON or unparseable body — leave as-is.
      }
    }
    return baseFetch(input, init)
  }
}
