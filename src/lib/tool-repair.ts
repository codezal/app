// Tool-call repair — model malformed tool çağrısı ürettiğinde tek adım daha vermeden düzeltmeyi dene.
// AI SDK'nın `experimental_repairToolCall` hook'u ile bağlanır.
//
// İki sınıf hata yakalanır:
// - NoSuchToolError       → tool adı bulunamadı (fuzzy match, snake/camel/dash normalizasyonu)
// - InvalidToolInputError → input schema'ya uymadı (JSON repair: trailing comma, single quote, kesik bracket)
//
// Repair başarısızsa null döner → SDK orijinal hatayı kullanıcıya fırlatır.
import type { ToolSet } from "ai"
import { NoSuchToolError, InvalidToolInputError } from "ai"
import type { LanguageModelV3ToolCall } from "@ai-sdk/provider"

// Aday tool adlarına normalize karşılaştırma — alt/üst, _/- kaldır.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, "")
}

// Hatalı tool adına en yakın gerçek tool'u bul. Sadece açık benzerlikte eşle.
// @internal — test için export.
export function fuzzyMatchToolName(want: string, tools: ToolSet): string | null {
  const names = Object.keys(tools)
  const nw = normalize(want)
  // 1) tam normalize eşleşme
  for (const n of names) {
    if (normalize(n) === nw) return n
  }
  // 2) prefix
  for (const n of names) {
    const nn = normalize(n)
    if (nn.startsWith(nw) || nw.startsWith(nn)) return n
  }
  // 3) substring (her iki yönde)
  for (const n of names) {
    const nn = normalize(n)
    if (nn.includes(nw) || nw.includes(nn)) return n
  }
  return null
}

// Hızlı JSON repair — yaygın model hatalarını yamala.
// Eğer parse edilebiliyorsa olduğu gibi döner.
// Edilemiyorsa: trailing comma kaldır, tek tırnak→çift tırnak, kesik brace/bracket kapat.
// @internal — test için export.
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

  // Markdown code fence sıyır (```json\n...\n```)
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "")

  // Trailing comma: }, veya ],
  s = s.replace(/,(\s*[}\]])/g, "$1")

  let attempt = tryParse(s)
  if (attempt) return attempt

  // Single quote anahtarları/değerleri double quote'a çevir — string literal içeriğine müdahale etmeden.
  // Basit yaklaşım: kelime sınırında 'foo' → "foo".
  const sqRepaired = s.replace(
    /(?<![A-Za-z0-9_])'([^'\\]*(?:\\.[^'\\]*)*)'(?![A-Za-z0-9_])/g,
    (_m, inner: string) => '"' + inner.replace(/"/g, '\\"') + '"',
  )
  attempt = tryParse(sqRepaired)
  if (attempt) return attempt
  s = sqRepaired

  // Kesik bracket dengeleme — string + escape farkında stack ile sırayı koru.
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
  // Açık string'i kapat
  if (inString) s += '"'
  // Stack'i tersinden kapat — son açılan ilk kapanır.
  for (let i = stack.length - 1; i >= 0; i--) {
    s += stack[i] === "{" ? "}" : "]"
  }

  attempt = tryParse(s)
  return attempt
}

// AI SDK için repair fonksiyonu — streamText/generateText'e geçilir.
export function makeToolCallRepair<T extends ToolSet>(): (opts: {
  toolCall: LanguageModelV3ToolCall
  tools: T
  error: NoSuchToolError | InvalidToolInputError
}) => Promise<LanguageModelV3ToolCall | null> {
  return async ({ toolCall, tools, error }) => {
    // 1) Tool adı yok → fuzzy match
    if (NoSuchToolError.isInstance(error)) {
      const fixed = fuzzyMatchToolName(toolCall.toolName, tools)
      if (!fixed) {
        console.warn(`[repair] '${toolCall.toolName}' tool'u bulunamadı, eşleşme yok`)
        return null
      }
      console.info(`[repair] tool adı '${toolCall.toolName}' → '${fixed}'`)
      return { ...toolCall, toolName: fixed }
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
        // Aynı şey — schema mismatch, JSON sorunu değil
        return null
      }
      console.info(`[repair] '${toolCall.toolName}' input JSON yamalandı`)
      return { ...toolCall, input: repaired }
    }

    return null
  }
}
