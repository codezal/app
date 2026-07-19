import { readWorkspaceSkills, readUserSkills } from "./user"
import { listPluginSkills } from "./plugin"
import { listMcpSkills } from "./mcp"
import { dedupSkillsByName } from "./dedup"
import { buildSkillsCatalog } from "./parse"
import { relevanceScore } from "../methods"
import type { Skill } from "./types"

const SKILLS_RAG_THRESHOLD = 8
const SKILLS_RAG_TOPK = 6

export type SkillsPromptOptions = {
  recentText?: string
  disabledSkills?: string[]
}

export async function loadSkillByName(
  workspace: string | undefined,
  name: string,
): Promise<Skill | null> {
  const [proj, user] = await Promise.all([
    readWorkspaceSkills(workspace),
    readUserSkills(),
  ])
  return (
    proj.find((s) => s.name === name) ??
    user.find((s) => s.name === name) ??
    listPluginSkills().find((s) => s.name === name) ??
    listMcpSkills().find((s) => s.name === name) ??
    null
  )
}

export async function listAllSkills(workspace: string | undefined): Promise<Skill[]> {
  const [proj, user] = await Promise.all([
    readWorkspaceSkills(workspace),
    readUserSkills(),
  ])
  return dedupSkillsByName([...proj, ...user, ...listPluginSkills(), ...listMcpSkills()])
}

export async function buildSkillsPromptSection(
  workspace: string | undefined,
  options: SkillsPromptOptions = {},
): Promise<string> {
  try {
    const all = await listAllSkills(workspace)
    const disabled = new Set(options.disabledSkills ?? [])
    let visible = all.filter((skill) => !disabled.has(skill.name))
    const recentText = options.recentText?.trim()

    if (recentText && visible.length > SKILLS_RAG_THRESHOLD) {
      const ranked = visible
        .map((skill) => ({
          skill,
          score: relevanceScore(
            `${skill.name} ${skill.description} ${(skill.triggers ?? []).join(" ")}`,
            recentText,
          ),
        }))
        .sort((a, b) => b.score - a.score)
      if (ranked.some((entry) => entry.score > 0)) {
        visible = ranked.slice(0, SKILLS_RAG_TOPK).map((entry) => entry.skill)
      }
    }

    return buildSkillsCatalog(visible)
  } catch {
    return ""
  }
}

export { readWorkspaceSkills, readUserSkills, readSkillsDir, listSkillFiles } from "./user"
export { parseSkillFile, buildSkillsCatalog } from "./parse"
export { parseFrontmatter } from "./frontmatter"
export { dedupSkillsByName } from "./dedup"
export {
  listPluginSkills,
  _registerPluginSkill,
  _unregisterPluginSkills,
  _clearPluginSkills,
} from "./plugin"
export { listMcpSkills, refreshMcpSkills, _clearMcpSkills } from "./mcp"
export type { Skill, SkillScope, SkillOrigin } from "./types"
