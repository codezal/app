import type { HarnessMessage } from "./types"

const MAX_MSG_CHARS = 8000

//   string                              → kendisi
//   [{type:"input_text"|"output_text"}] → text (Codex/OpenAI)
//   {text:"..."} / {content:...}        → recurse
export function extractText(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map(extractText)
      .filter((s) => s.length > 0)
      .join("\n")
  }
  if (typeof content === "object") {
    const o = content as Record<string, unknown>
    if (typeof o.text === "string") return o.text
    // tool_result / nested content
    if (o.content != null) return extractText(o.content)
    return ""
  }
  return ""
}

export function cleanOneLine(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

export function deriveTitle(messages: HarnessMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim().length > 0)
  const base = firstUser?.text ?? messages[0]?.text ?? ""
  return cleanOneLine(base) || "(başlıksız)"
}

export function capText(s: string): string {
  return s.length > MAX_MSG_CHARS ? s.slice(0, MAX_MSG_CHARS) : s
}

export function baseName(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(0, i) : name
}

export function safeJsonParse(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw)
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}
