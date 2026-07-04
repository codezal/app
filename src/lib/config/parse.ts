// JSONC parsing for hand-edited config files (project `.codezal/config.json`).
//
// settings.json is GUI-managed and stays strict JSON, but the project config
// is meant to be authored by hand — so we accept comments (`//`, `/* */`) and
// trailing commas, and on failure we emit a line/column + caret diagnostic
// instead of V8's terse "Unexpected token" message.
//
// Implemented without a third-party dependency: a small string-aware scanner
// strips comments (never inside string literals) and trailing commas, then the
// result is fed to JSON.parse.
import { errorMessage } from "@/lib/errors"

export class ConfigParseError extends Error {
  readonly source: string

  constructor(source: string, message: string) {
    super(message)
    this.name = "ConfigParseError"
    this.source = source
  }
}

// Remove comments and trailing commas, preserving string contents verbatim.
// The output is byte-for-byte aligned with the input outside of removed spans,
// so offsets reported by JSON.parse still map back to the original text.
function stripJsonc(text: string): string {
  let out = ""
  let i = 0
  const n = text.length
  let inString = false
  let escaped = false

  while (i < n) {
    const ch = text[i]

    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      i++
      continue
    }

    // Line comment — replace with nothing up to (but not including) the newline.
    if (ch === "/" && text[i + 1] === "/") {
      i += 2
      while (i < n && text[i] !== "\n") i++
      continue
    }

    // Block comment — replace its span with equivalent whitespace/newlines so
    // line numbers in error diagnostics stay accurate.
    if (ch === "/" && text[i + 1] === "*") {
      i += 2
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " "
        i++
      }
      i += 2 // skip closing */
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }

    out += ch
    i++
  }

  // Drop trailing commas: `,` followed by optional whitespace then `}` or `]`.
  return out.replace(/,(\s*[}\]])/g, "$1")
}

// Turn a character offset into a `line N, column M` + source-line + caret block.
function formatLocation(text: string, offset: number): string {
  const before = text.slice(0, offset)
  const lines = before.split("\n")
  const line = lines.length
  const column = lines[lines.length - 1].length + 1
  const sourceLine = text.split("\n")[line - 1] ?? ""
  const caret = " ".repeat(Math.max(0, column - 1)) + "^"
  return `line ${line}, column ${column}\n   ${sourceLine}\n   ${caret}`
}

// Best-effort extraction of the failing offset from a V8 JSON parse error.
// Newer Node embeds "in JSON at position 123"; older builds may not.
function offsetFromError(message: string): number | undefined {
  const m = message.match(/position (\d+)/)
  return m ? Number(m[1]) : undefined
}

// Parse JSONC text into an unknown value. Throws ConfigParseError with a
// human-readable diagnostic on malformed input.
export function parseJsonc(text: string, source: string): unknown {
  const cleaned = stripJsonc(text)
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    const message = errorMessage(err)
    const offset = offsetFromError(message)
    const location = offset !== undefined ? `\n${formatLocation(cleaned, offset)}` : ""
    throw new ConfigParseError(source, `Invalid JSON in ${source}: ${message}${location}`)
  }
}
