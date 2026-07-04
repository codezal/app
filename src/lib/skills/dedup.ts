// project.codezal > project.agents > user.codezal > user.agents > plugin.
import type { Skill } from "./types"

export function dedupSkillsByName(skills: Skill[]): Skill[] {
  const seen = new Set<string>()
  const out: Skill[] = []
  for (const s of skills) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    out.push(s)
  }
  return out
}
