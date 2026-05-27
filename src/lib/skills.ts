// Re-export shim — skills/ dizinine taşındı.
export {
  readWorkspaceSkills,
  readUserSkills,
  loadSkillByName,
  listAllSkills,
  parseSkillFile,
  buildSkillsCatalog,
} from "./skills/index"
export type { Skill, SkillScope } from "./skills/types"
