// Rebuild the AI SDK model history from persisted UI messages + parts.
//
// `Session.modelMessages` is intentionally RAM-only (sessionToRow drops it to
// keep the SQLite blob small — tool outputs already live in the `part` table).
// After an app restart the model history is therefore rebuilt from
// `messages` + `parts`. The previous fallback (plain `content` strings only)
// silently dropped every tool call and tool result, so the model "forgot" the
// files it had read and the commands it had run — the chat looked intact on
// screen but the model received a gutted history ("what are you talking
// about?"). This rebuild restores the full assistant/tool turn structure.
//
// Message-count parity: the rebuild must produce the same number of
// ModelMessages per UI message as the original run did (`modelMsgCount`),
// because truncateAfter/forkAt slice `modelMessages` by those counts.
// Mapping: user → 1, assistant → 1 assistant message per text/tool-call run
// plus one tool message per tool-result part (matching AI SDK
// `response.messages` layout: assistant w/ tool-calls → tool results →
// assistant text …).

import type { ModelMessage } from "ai"
import type { Message, Part } from "@/store/types"

type AssistantPart = Extract<ModelMessage, { role: "assistant" }>["content"]
type AssistantContentPart = Exclude<AssistantPart, string>[number]
type ToolResultContentPart = Extract<ModelMessage, { role: "tool" }>["content"][number]

function toToolResultPart(p: Extract<Part, { type: "tool-result" }>): ToolResultContentPart {
  return {
    type: "tool-result",
    toolCallId: p.toolCallId,
    toolName: p.toolName,
    output: p.isError
      ? { type: "error-text", value: p.output }
      : { type: "text", value: p.output },
  }
}

function userContent(m: Message): ModelMessage | null {
  const text = m.content
  if (!text.trim()) return null
  return { role: "user", content: text }
}

function assistantMessages(m: Message): ModelMessage[] {
  const out: ModelMessage[] = []
  const parts = m.parts ?? []

  // Legacy / part-less messages (e.g. imported from the JSON store or written
  // before parts existed): fall back to the plain content string.
  if (parts.length === 0) {
    if (m.content.trim()) out.push({ role: "assistant", content: m.content })
    return out
  }

  let buf: AssistantContentPart[] = []
  const flushAssistant = () => {
    if (buf.length === 0) return
    out.push({ role: "assistant", content: buf })
    buf = []
  }

  for (const p of parts) {
    switch (p.type) {
      case "text":
        if (p.text.trim()) buf.push({ type: "text", text: p.text })
        break
      case "reasoning":
        if (p.text.trim()) buf.push({ type: "reasoning", text: p.text })
        break
      case "tool-call":
        buf.push({ type: "tool-call", toolCallId: p.toolCallId, toolName: p.toolName, input: p.input })
        break
      case "tool-result":
        // Tool results are their own `tool` message in the AI SDK wire
        // format — flush the pending assistant run first.
        flushAssistant()
        out.push({ role: "tool", content: [toToolResultPart(p)] })
        break
      default:
        // agent-card and future UI-only parts are not model input.
        break
    }
  }
  flushAssistant()

  // Safety net: parts existed but carried no model-visible content (e.g. only
  // agent cards) — keep the turn addressable via its collapsed text.
  if (out.length === 0 && m.content.trim()) {
    out.push({ role: "assistant", content: m.content })
  }
  return out
}

export function messagesToModelMessages(msgs: Message[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of msgs) {
    if (m.pending) continue
    if (m.role === "user") {
      const msg = userContent(m)
      if (msg) out.push(msg)
    } else if (m.role === "assistant") {
      out.push(...assistantMessages(m))
    }
    // system/tool UI rows (compaction notices, status lines) are not part of
    // the model history.
  }
  return out
}
