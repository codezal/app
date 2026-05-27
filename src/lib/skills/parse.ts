// SKILL.md frontmatter parser.
import type { Skill } from "./types"

const MAX_BODY = 32_000

export function parseSkillFile(
  raw: string,
  fallbackName: string,
): {
  name: string
  description: string
  triggers?: string[]
  body: string
} {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return { name: fallbackName, description: "", body: raw.slice(0, MAX_BODY) }
  }
  const fm = m[1]
  const body = m[2].slice(0, MAX_BODY)
  const obj: Record<string, unknown> = {}
  for (const line of fm.split("\n")) {
    const km = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/)
    if (!km) continue
    const key = km[1].trim()
    const val = km[2].trim()
    if (val.startsWith("[") && val.endsWith("]")) {
      obj[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    } else {
      obj[key] = val.replace(/^["']|["']$/g, "")
    }
  }
  return {
    name: String(obj.name ?? fallbackName),
    description: String(obj.description ?? ""),
    triggers: Array.isArray(obj.triggers) ? (obj.triggers as string[]) : undefined,
    body,
  }
}

// System prompt'a iliştirilecek özet — sadece isim+açıklama
export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return ""
  const lines = ["# Mevcut Skills (on-demand)"]
  lines.push("Bu skill'leri kullanmak için `load_skill` tool'unu çağır.")
  lines.push("")
  for (const s of skills) {
    const trig = s.triggers?.length ? ` · trig: ${s.triggers.join(", ")}` : ""
    const tag = s.pluginId ? ` [plugin:${s.pluginId}]` : ""
    lines.push(`- **${s.name}** (${s.scope}${tag}): ${s.description}${trig}`)
  }
  return lines.join("\n")
}
