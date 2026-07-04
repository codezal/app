//
//
import type { ModelMessage } from "ai"
import { BUILTIN_PATTERNS, DEFAULT_DETECTORS, type Detection, type PiiType } from "./patterns"

export type { Detection, PiiType } from "./patterns"
export { BUILTIN_PATTERNS, DEFAULT_DETECTORS } from "./patterns"

export interface CustomPattern {
  label: string
  pattern: string
}

export interface PrivacySettings {
  enabled: boolean
  detectors?: Partial<Record<PiiType, boolean>>
  customPatterns?: CustomPattern[]
  scrubAssistant?: boolean
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  enabled: false,
  detectors: { ...DEFAULT_DETECTORS },
  customPatterns: [],
  scrubAssistant: false,
}

export function isCloudProvider(providerId: string): boolean {
  return providerId !== "local"
}

export function privacyActive(settings: PrivacySettings | undefined, providerId: string): boolean {
  return !!settings?.enabled && isCloudProvider(providerId)
}

function compileCustom(patterns: CustomPattern[] | undefined): { label: string; re: RegExp }[] {
  if (!patterns?.length) return []
  const out: { label: string; re: RegExp }[] = []
  for (const p of patterns) {
    if (!p.pattern?.trim()) continue
    try {
      out.push({ label: p.label || "CUSTOM", re: new RegExp(p.pattern, "g") })
    } catch {
      // Intentionally ignored.
    }
  }
  return out
}

export function detect(text: string, settings?: PrivacySettings): Detection[] {
  if (!text) return []
  const detectors = { ...DEFAULT_DETECTORS, ...(settings?.detectors ?? {}) }
  const raw: Detection[] = []

  for (const def of BUILTIN_PATTERNS) {
    if (detectors[def.type] === false) continue
    def.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = def.re.exec(text)) !== null) {
      if (m.index === def.re.lastIndex) def.re.lastIndex++
      const gi = def.group ?? 0
      const value = m[gi]
      if (!value) continue
      if (def.validate && !def.validate(m[0])) continue
      const start = gi === 0 ? m.index : m.index + m[0].indexOf(value)
      raw.push({ type: def.type, value, start, end: start + value.length })
    }
  }

  for (const c of compileCustom(settings?.customPatterns)) {
    c.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = c.re.exec(text)) !== null) {
      if (m.index === c.re.lastIndex) c.re.lastIndex++
      const value = m[0]
      if (!value) continue
      raw.push({ type: "CUSTOM", value, start: m.index, end: m.index + value.length, label: c.label })
    }
  }

  raw.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Detection[] = []
  let lastEnd = -1
  for (const d of raw) {
    if (d.start >= lastEnd) {
      out.push(d)
      lastEnd = d.end
    }
  }
  return out
}

export class PrivacyScrubber {
  private readonly settings: PrivacySettings
  private readonly forward = new Map<string, string>()
  private readonly reverse = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  constructor(settings: PrivacySettings) {
    this.settings = settings
  }

  get count(): number {
    return this.forward.size
  }

  private placeholderFor(d: Detection): string {
    const existing = this.forward.get(d.value)
    if (existing) return existing
    const tag = d.type === "CUSTOM" ? (d.label || "CUSTOM").toUpperCase().replace(/[^A-Z0-9]/g, "_") : d.type
    const n = (this.counters.get(tag) ?? 0) + 1
    this.counters.set(tag, n)
    const ph = `[${tag}_${n}]`
    this.forward.set(d.value, ph)
    this.reverse.set(ph, d.value)
    return ph
  }

  scrubText(text: string): string {
    const dets = detect(text, this.settings)
    if (dets.length === 0) return text
    let out = text
    for (let i = dets.length - 1; i >= 0; i--) {
      const d = dets[i]
      const ph = this.placeholderFor(d)
      out = out.slice(0, d.start) + ph + out.slice(d.end)
    }
    return out
  }

  scrubMessages(messages: ModelMessage[]): ModelMessage[] {
    const scrubAssistant = this.settings.scrubAssistant ?? false
    return messages.map((msg) => {
      const role = msg.role
      const eligible = role === "system" || role === "user" || (scrubAssistant && role === "assistant")
      if (!eligible) return msg
      if (typeof msg.content === "string") {
        return { ...msg, content: this.scrubText(msg.content) } as ModelMessage
      }
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((p) => {
            const part = p as Record<string, unknown> & { type?: string; text?: unknown }
            if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
              return { ...part, text: this.scrubText(part.text) }
            }
            return part
          }),
        } as ModelMessage
      }
      return msg
    })
  }

  unscrub(text: string): string {
    if (!text || this.reverse.size === 0) return text
    return text.replace(/\[[A-Z0-9_]+_\d+\]/g, (m) => this.reverse.get(m) ?? m)
  }

  verify(messages: ModelMessage[]): Detection[] {
    const leaks: Detection[] = []
    const scrubAssistant = this.settings.scrubAssistant ?? false
    for (const msg of messages) {
      const role = msg.role
      const eligible = role === "system" || role === "user" || (scrubAssistant && role === "assistant")
      if (!eligible) continue
      const texts: string[] = []
      if (typeof msg.content === "string") texts.push(msg.content)
      else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          const part = p as { type?: string; text?: unknown }
          if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
            texts.push(part.text)
          }
        }
      }
      for (const txt of texts) {
        for (const d of detect(txt, this.settings)) {
          if (!this.reverse.has(d.value)) leaks.push(d)
        }
      }
    }
    return leaks
  }
}
