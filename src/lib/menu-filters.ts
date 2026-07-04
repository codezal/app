import type { SlashCommand } from "@/lib/commands"
import type { MentionItem } from "@/components/MentionMenu"

export function fuzzyScore(text: string, q: string): number | null {
  if (!q) return 0
  let ti = 0
  let score = 0
  let streak = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let i = ti; i < text.length; i++) {
      if (text[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return null
    const contiguous = found === ti
    streak = contiguous ? streak + 1 : 0
    const wordStart = found === 0 || /[\s/_.-]/.test(text[found - 1])
    score += 1 + streak * 3 + (wordStart ? 4 : 0) - found * 0.05
    ti = found + 1
  }
  return score
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase().trim()
  if (!q) return commands
  const scored: Array<{ c: SlashCommand; score: number }> = []
  for (const c of commands) {
    const nameScore = fuzzyScore(c.name.toLowerCase(), q)
    const descScore = fuzzyScore(c.description.toLowerCase(), q)
    const score = Math.max(
      nameScore ?? Number.NEGATIVE_INFINITY,
      descScore != null ? descScore - 100 : Number.NEGATIVE_INFINITY,
    )
    if (score > Number.NEGATIVE_INFINITY) scored.push({ c, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.c)
}

const MENTION_LIMIT = 50

export function filterMentions(items: MentionItem[], query: string): MentionItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return items.slice(0, MENTION_LIMIT)
  const fieldsOf = (it: MentionItem): string[] => {
    if (it.kind === "file") return [it.name, it.rel]
    if (it.kind === "branch") return [it.name]
    if (it.kind === "skill") return [it.name, it.description ?? ""]
    if (it.kind === "problems") return ["problems", "diagnostics", "errors"]
    return [it.name, it.uri, it.description ?? ""]
  }
  const scored: Array<{ it: MentionItem; score: number }> = []
  for (const it of items) {
    let best = Number.NEGATIVE_INFINITY
    for (const f of fieldsOf(it)) {
      const s = fuzzyScore(f.toLowerCase(), q)
      if (s != null && s > best) best = s
    }
    if (best > Number.NEGATIVE_INFINITY) scored.push({ it, score: best })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MENTION_LIMIT).map((s) => s.it)
}
