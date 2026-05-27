// User/workspace skill okuyucusu — .codezal/skills/<name>/SKILL.md tarar.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { parseSkillFile } from "./parse"
import type { Skill, SkillScope } from "./types"

export async function readWorkspaceSkills(
  workspace: string | undefined,
): Promise<Skill[]> {
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

export async function readSkillsDir(
  root: string,
  scope: SkillScope,
): Promise<Skill[]> {
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
