import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { parseSkillFile } from "./parse"
import { IGNORE_DIRS } from "../ignore"
import type { Skill, SkillOrigin, SkillScope } from "./types"

const MAX_DEPTH = 6

const ROOTS: { rel: string; origin: SkillOrigin }[] = [
  { rel: ".codezal/skills", origin: "codezal" },
  { rel: ".agents/skills", origin: "agents" },
]

export async function readWorkspaceSkills(
  workspace: string | undefined,
): Promise<Skill[]> {
  if (!workspace) return []
  const base = workspace.replace(/[\\/]+$/, "")
  const out: Skill[] = []
  for (const { rel, origin } of ROOTS) {
    out.push(...(await readSkillsDir(`${base}/${rel}`, "project", origin)))
  }
  return out
}

export async function readUserSkills(): Promise<Skill[]> {
  try {
    const base = (await homeDir()).replace(/[\\/]+$/, "")
    const out: Skill[] = []
    for (const { rel, origin } of ROOTS) {
      out.push(...(await readSkillsDir(`${base}/${rel}`, "global", origin)))
    }
    return out
  } catch {
    return []
  }
}

export async function readSkillsDir(
  root: string,
  scope: SkillScope,
  origin: SkillOrigin = "codezal",
): Promise<Skill[]> {
  try {
    if (!(await exists(root))) return []
  } catch {
    return []
  }
  const found: string[] = []
  await walk(root, 0, found)
  const out: Skill[] = []
  for (const skillPath of found) {
    try {
      const raw = await readTextFile(skillPath)
      const dir = skillPath.replace(/[\\/]+SKILL\.md$/, "")
      const fallbackName = dir.split(/[\\/]/).pop() || "skill"
      const parsed = parseSkillFile(raw, fallbackName)
      out.push({
        ...parsed,
        path: skillPath,
        dir,
        scope,
        origin,
        bytes: raw.length,
      })
    } catch {
      // Intentionally ignored.
    }
  }
  return out
}

export async function listSkillFiles(dir: string, cap = 15): Promise<string[]> {
  const base = dir.replace(/[\\/]+$/, "")
  const files: string[] = []
  await walkFiles(base, 0, files)
  const rel = files
    .map((f) => (f.startsWith(base) ? f.slice(base.length).replace(/^[\\/]+/, "") : f))
    .filter((r) => r !== "SKILL.md")
    .sort((a, b) => a.localeCompare(b))
  return rel.slice(0, cap)
}

async function walkFiles(cur: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = await readDir(cur)
  } catch {
    return
  }
  for (const e of entries) {
    const abs = cur.replace(/[\\/]+$/, "") + "/" + e.name
    if (e.isDirectory) {
      if (IGNORE_DIRS.has(e.name)) continue
      await walkFiles(abs, depth + 1, out)
    } else {
      out.push(abs)
    }
  }
}

async function walk(cur: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = await readDir(cur)
  } catch {
    return
  }
  for (const e of entries) {
    const abs = cur.replace(/[\\/]+$/, "") + "/" + e.name
    if (e.isDirectory) {
      if (IGNORE_DIRS.has(e.name)) continue
      await walk(abs, depth + 1, out)
    } else if (e.name === "SKILL.md") {
      out.push(abs)
    }
  }
}
