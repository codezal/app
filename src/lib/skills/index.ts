import { readWorkspaceSkills, readUserSkills } from "./user"
import { listPluginSkills } from "./plugin"
import { listMcpSkills } from "./mcp"
import { dedupSkillsByName } from "./dedup"
import { buildSkillsCatalog } from "./parse"
import type { Skill } from "./types"

export type SkillsPromptOptions = {
  // Accepted for backward compatibility with existing callers but intentionally
  // unused: the catalog order is now fixed (declaration order) so the prompt
  // prefix stays byte-identical across turns (prompt-cache friendly). The old
  // relevance re-ranking by the latest user message mutated the order every
  // turn and broke the cache.
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
    const visible = all.filter((skill) => !disabled.has(skill.name))
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
