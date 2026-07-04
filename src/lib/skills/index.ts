import { readWorkspaceSkills, readUserSkills } from "./user"
import { listPluginSkills } from "./plugin"
import { listMcpSkills } from "./mcp"
import { dedupSkillsByName } from "./dedup"
import type { Skill } from "./types"

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
