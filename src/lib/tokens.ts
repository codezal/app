
import type { ModelMessage } from "ai"

const CHARS_PER_TOKEN = 4
const PER_MESSAGE_OVERHEAD = 4
const PER_TOOL_OVERHEAD = 12

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
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
): number {
  let total = systemPrompt ? estimateTextTokens(systemPrompt) + PER_MESSAGE_OVERHEAD : 0
  for (const m of messages) {
    total += PER_MESSAGE_OVERHEAD
    total += tokensForContent(m.content)
  }
  return total
}
