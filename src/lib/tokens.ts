
import type { ModelMessage } from "ai"

const CHARS_PER_TOKEN = 4
const PER_MESSAGE_OVERHEAD = 4
const PER_TOOL_OVERHEAD = 12
// Conservative per-image estimate (Anthropic bills ~1600 tok for a typical
// screenshot; OpenAI tiles vary). A fixed constant avoids over-counting from
// base64 string length while keeping the gauge aware images exist.
const PER_IMAGE_TOKENS = 1_500
// Average token cost of a single tool definition (description + JSON input
// schema) on the wire. Used to close the gap between the text-only estimate
// and the real prompt size when many tools (especially MCP) are registered.
const AVG_TOOL_SCHEMA_TOKENS = 200

/**
 * Token estimator for gauge + compaction decisions.
 *
 * Prefer provider usage when available (see `context-gauge`). When we must
 * approximate from text, ASCII runs pack at ~4 chars/token and non-ASCII
 * (CJK, emoji, …) count as ~1 token each. A naive `length / 4` under-counts
 * Turkish/CJK text and delays compaction past the real window.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  let asciiRun = 0
  let tokens = 0
  const flushAscii = (): void => {
    if (asciiRun > 0) {
      tokens += Math.ceil(asciiRun / CHARS_PER_TOKEN)
      asciiRun = 0
    }
  }
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += 1
      continue
    }
    flushAscii()
    // Zero-width combining marks are not billed as their own tokens.
    tokens += isCombiningMark(char) ? 0 : 1
  }
  flushAscii()
  return tokens
}

function isCombiningMark(char: string): boolean {
  return /[\u0300-\u036f\ufe00-\ufe0f]/u.test(char)
}

function tokensForContent(content: unknown): number {
  if (content == null) return 0
  if (typeof content === "string") return estimateTextTokens(content)
  if (Array.isArray(content)) {
    let total = 0
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const p = part as Record<string, unknown>
      // text part
      if (typeof p.text === "string") total += estimateTextTokens(p.text)
      // tool-call input (JSON)
      if (p.type === "tool-call" && p.input !== undefined) {
        total += estimateTextTokens(safeJson(p.input)) + PER_TOOL_OVERHEAD
      }
      // tool-result output
      if (p.type === "tool-result") {
        const out =
          typeof p.output === "string" ? p.output : safeJson(p.output)
        total += estimateTextTokens(out) + PER_TOOL_OVERHEAD
      }
      // reasoning / thinking
      if (typeof p.reasoning === "string") total += estimateTextTokens(p.reasoning)
      // image part (screenshot, inline image) — providers tokenize by pixels,
      // not bytes; use a fixed estimate so the gauge doesn't ignore images.
      if (p.type === "image") total += PER_IMAGE_TOKENS
    }
    return total
  }
  return estimateTextTokens(safeJson(content))
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ""
  } catch {
    return String(v ?? "")
  }
}

export function estimateMessagesTokens(
  messages: ModelMessage[],
  systemPrompt?: string,
  toolCount?: number,
): number {
  let total = systemPrompt ? estimateTextTokens(systemPrompt) + PER_MESSAGE_OVERHEAD : 0
  for (const m of messages) {
    total += PER_MESSAGE_OVERHEAD
    total += tokensForContent(m.content)
  }
  // Tool definitions (description + input schema) are sent alongside messages
  // but are not part of the message array — add their estimated wire cost.
  if (toolCount && toolCount > 0) {
    total += toolCount * AVG_TOOL_SCHEMA_TOKENS
  }
  return total
}
