
import { type Method, type MethodsConfig, DEFAULT_METHODS_CONFIG } from "./types"

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zçğıöşü0-9_]+/i)
      .filter((w) => w.length >= 2),
  )
}

export function relevanceScore(text: string, query: string): number {
  const q = tokenSet(query)
  if (q.size === 0) return 0
  const t = tokenSet(text)
  if (t.size === 0) return 0
  let hit = 0
  for (const w of q) if (t.has(w)) hit++
  return hit / q.size
}

function scoreMethod(m: Method, query: string | undefined, now: number): number {
  const usageBoost = 1 + Math.log1p(m.useCount) * 0.2
  if (!query?.trim()) {
    const ageDays = Math.max(0, (now - m.lastUsedAt) / 86_400_000)
    return usageBoost * Math.pow(0.5, ageDays / 30)
  }
  const text = `${m.name} ${m.description} ${(m.triggers ?? []).join(" ")}`
  return relevanceScore(text, query) * usageBoost
}

export function selectMethods(
  methods: Method[],
  opts: { query?: string; now: number; topK?: number; cfg?: MethodsConfig },
): Method[] {
  const cfg = opts.cfg ?? DEFAULT_METHODS_CONFIG
  const k = opts.topK ?? cfg.topK
  const scored = methods
    .map((m) => ({ m, s: scoreMethod(m, opts.query, opts.now) }))
    .filter((x) => (opts.query?.trim() ? x.s > 0 : true))
    .sort((a, b) => b.s - a.s)
  return scored.slice(0, k).map((x) => x.m)
}

export function renderMethodsCatalog(methods: Method[]): string {
  if (methods.length === 0) return ""
  const lines = ["# Öğrenilmiş Yöntemler (methods)", "Bu görev biçimleri geçmiş başarılı işlerden damıtıldı; ilgiliyse adımları izle.", ""]
  for (const m of methods) {
    lines.push(`## ${m.name}`)
    lines.push(m.description)
    if (m.steps.length) {
      m.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}

export function upsertMethod(methods: Method[], next: Method, cfg: MethodsConfig = DEFAULT_METHODS_CONFIG): Method[] {
  const out = methods.filter((m) => !(m.scope === next.scope && m.name === next.name))
  const prior = methods.find((m) => m.scope === next.scope && m.name === next.name)
  if (prior) next.useCount = Math.max(next.useCount, prior.useCount)
  out.push(next)
  if (out.length <= cfg.maxMethods) return out
  const now = next.createdAt
  return [...out]
    .sort((a, b) => scoreMethod(b, undefined, now) - scoreMethod(a, undefined, now))
    .slice(0, cfg.maxMethods)
}
