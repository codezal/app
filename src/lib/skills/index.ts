// Skill registry — workspace + user + plugin birleşimi.
import { readWorkspaceSkills, readUserSkills } from "./user"
import { listPluginSkills } from "./plugin"
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
    null
  )
}

export async function listAllSkills(workspace: string | undefined): Promise<Skill[]> {
  const [proj, user] = await Promise.all([
    readWorkspaceSkills(workspace),
    readUserSkills(),
  ])
  return [...proj, ...user, ...listPluginSkills()]
}

export { readWorkspaceSkills, readUserSkills, readSkillsDir } from "./user"
export { parseSkillFile, buildSkillsCatalog } from "./parse"
export {
  listPluginSkills,
  _registerPluginSkill,
  _unregisterPluginSkills,
  _clearPluginSkills,
} from "./plugin"
export type { Skill, SkillScope } from "./types"
