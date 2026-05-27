// Skills — on-demand instructions. SKILL.md frontmatter + body.
// .codezal/skills/<name>/SKILL.md (workspace) ve ~/.codezal/skills/<name>/SKILL.md (global)
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

export type SkillScope = "project" | "global"

export type Skill = {
  name: string
  description: string
  path: string // SKILL.md tam yolu
  dir: string // skill klasörü
  scope: SkillScope
  triggers?: string[]
  body: string // YAML stripped, asıl talimat
  bytes: number
}

const MAX_BODY = 32_000

export async function readWorkspaceSkills(workspace: string | undefined): Promise<Skill[]> {
  if (!workspace) return []
  const root = workspace.replace(/[\\/]+$/, "") + "/.codezal/skills"
  return readSkillsDir(root, "project")
}

export async function readUserSkills(): Promise<Skill[]> {
  try {
    const home = await homeDir()
    const root = home.replace(/[\\/]+$/, "") + "/.codezal/skills"
    return readSkillsDir(root, "global")
  } catch {
    return []
  }
}

async function readSkillsDir(root: string, scope: SkillScope): Promise<Skill[]> {
  try {
    if (!(await exists(root))) return []
  } catch {
    return []
  }
  let entries
  try {
    entries = await readDir(root)
  } catch {
    return []
  }
  const out: Skill[] = []
  for (const e of entries) {
    if (!e.isDirectory) continue
    const dir = root + "/" + e.name
    const skillPath = dir + "/SKILL.md"
    try {
      if (!(await exists(skillPath))) continue
      const raw = await readTextFile(skillPath)
      const parsed = parseSkillFile(raw, e.name)
      out.push({
        ...parsed,
        path: skillPath,
        dir,
        scope,
        bytes: raw.length,
      })
    } catch {
      // sessiz atla
    }
  }
  return out
}

// SKILL.md formatı:
// ---
// name: refactor
// description: kod cerrahisi için yönergeler
// triggers: [refactor, rename, cleanup]
// ---
// markdown body…
function parseSkillFile(raw: string, fallbackName: string): {
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
    // Basit array desteği: [a, b, c]
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

// System prompt'a iliştirilecek özet — sadece isim+açıklama (body değil)
export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return ""
  const lines = ["# Mevcut Skills (on-demand)"]
  lines.push("Bu skill'leri kullanmak için `load_skill` tool'unu çağır.")
  lines.push("")
  for (const s of skills) {
    const trig = s.triggers?.length ? ` · trig: ${s.triggers.join(", ")}` : ""
    lines.push(`- **${s.name}** (${s.scope}): ${s.description}${trig}`)
  }
  return lines.join("\n")
}

export async function loadSkillByName(
  workspace: string | undefined,
  name: string,
): Promise<Skill | null> {
  const [proj, user] = await Promise.all([
    readWorkspaceSkills(workspace),
    readUserSkills(),
  ])
  return [...proj, ...user].find((s) => s.name === name) ?? null
}
