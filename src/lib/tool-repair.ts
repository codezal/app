//
//
import type { ToolSet } from "ai"
import { NoSuchToolError, InvalidToolInputError } from "ai"
import type { LanguageModelV3ToolCall } from "@ai-sdk/provider"

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, "")
}

export function fuzzyMatchToolName(want: string, tools: ToolSet): string | null {
  const names = Object.keys(tools)
  const nw = normalize(want)
  for (const n of names) {
    if (normalize(n) === nw) return n
  }
  if (nw.length < 4) return null
  // 2) prefix
  for (const n of names) {
    const nn = normalize(n)
    if (nn.startsWith(nw) || nw.startsWith(nn)) return n
  }
  for (const n of names) {
    const nn = normalize(n)
    if (nn.includes(nw)) return n
  }
  return null
}

export function unwrapWrappedToolName(toolName: string): { name: string; input: string } | null {
  const t = toolName.trim()
  if (!t.startsWith("{")) return null
  let obj: unknown
  try {
    obj = JSON.parse(t)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  const rec = obj as Record<string, unknown>
  if (typeof rec.name !== "string" || !rec.name) return null
  const args = rec.arguments ?? rec.parameters ?? {}
  return { name: rec.name, input: typeof args === "string" ? args : JSON.stringify(args) }
}

export function looksLikeQuotedSyntax(toolName: string): boolean {
  return /[{}<>"'`\s]/.test(toolName) || toolName.length > 80
}

// Model output often contains JSON-invalid escapes inside strings — ANSI
// color codes like \x1b, a \u cut short by a truncated stream, or a lone
// backslash right before the input ends. JSON.parse rejects all of these
// ("unexpected end of hex escape"), so escape the backslash itself and keep
// the text literal. Valid escapes (including \uXXXX) pass through untouched.
export function fixInvalidEscapes(raw: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    if (ch !== "\\") {
      out += ch
      continue
    }
    const next = raw[i + 1]
    if (next === undefined) {
      // Lone backslash right before the string/stream ends.
      out += "\\\\"
      continue
    }
    if (
      next === '"' ||
      next === "\\" ||
      next === "/" ||
      next === "b" ||
      next === "f" ||
      next === "n" ||
      next === "r" ||
      next === "t"
    ) {
      out += ch + next
      i++
      continue
    }
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += ch + next + hex
        i += 5
        continue
      }
      // Truncated/invalid \u escape → literal backslash-u; hex chars stay literal.
      out += "\\\\u"
      i++
      continue
    }
    // Invalid escape (e.g. \x1b ANSI codes) → literal backslash + char.
    out += "\\\\" + next
    i++
  }
  return out
}

export function repairJsonString(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null
  const tryParse = (s: string): string | null => {
    try {
      JSON.parse(s)
      return s
    } catch {
      return null
    }
  }
  const direct = tryParse(raw)
  if (direct) return direct

  let s = raw.trim()

  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "")

  // Trailing comma: }, veya ],
  s = s.replace(/,(\s*[}\]])/g, "$1")

  let attempt = tryParse(s)
  if (attempt) return attempt

  // Invalid string escapes (\x1b, truncated \u, lone backslash) — repair
  // before the single-quote pass so its `\\.` matching sees clean escapes.
  const escFixed = fixInvalidEscapes(s)
  if (escFixed !== s) {
    attempt = tryParse(escFixed)
    if (attempt) return attempt
    s = escFixed
  }

  const sqRepaired = s.replace(
    /(?<![A-Za-z0-9_])'([^'\\]*(?:\\.[^'\\]*)*)'(?![A-Za-z0-9_])/g,
    (_m, inner: string) => '"' + inner.replace(/"/g, '\\"') + '"',
  )
  attempt = tryParse(sqRepaired)
  if (attempt) return attempt
  s = sqRepaired

  const stack: Array<"{" | "["> = []
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
  }
  if (inString) s += '"'
  for (let i = stack.length - 1; i >= 0; i--) {
    s += stack[i] === "{" ? "}" : "]"
  }

  attempt = tryParse(s)
  return attempt
}

export function makeToolCallRepair<T extends ToolSet>(): (opts: {
  toolCall: LanguageModelV3ToolCall
  tools: T
  error: NoSuchToolError | InvalidToolInputError
}) => Promise<LanguageModelV3ToolCall | null> {
  return async ({ toolCall, tools, error }) => {
    if (NoSuchToolError.isInstance(error)) {
      const unwrapped = unwrapWrappedToolName(toolCall.toolName)
      const want = unwrapped?.name ?? toolCall.toolName
      const fixed = fuzzyMatchToolName(want, tools)
      if (!fixed) {
        console.warn(`[repair] '${want}' tool'u bulunamadı, eşleşme yok`)
        return null
      }
      console.info(`[repair] tool adı '${toolCall.toolName}' → '${fixed}'`)
      return unwrapped
        ? { ...toolCall, toolName: fixed, input: unwrapped.input }
        : { ...toolCall, toolName: fixed }
    }

    // 2) Input invalid → JSON repair
    if (InvalidToolInputError.isInstance(error)) {
      const raw = typeof toolCall.input === "string" ? toolCall.input : ""
      const repaired = repairJsonString(raw)
      if (!repaired) {
        console.warn(`[repair] '${toolCall.toolName}' input parse edilemedi`)
        return null
      }
      if (repaired === raw) {
        return null
      }
      console.info(`[repair] '${toolCall.toolName}' input JSON yamalandı`)
      return { ...toolCall, input: repaired }
    }

    return null
  }
}
