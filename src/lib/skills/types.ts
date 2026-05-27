// Skill tipleri — skills/ modülünün ortak contract'ı.
export type SkillScope = "project" | "global" | "plugin"

export type Skill = {
  name: string
  description: string
  path: string // SKILL.md tam yolu
  dir: string // skill klasörü
  scope: SkillScope
  triggers?: string[]
  body: string
  bytes: number
  // Plugin kaynaklıysa hangi plugin'den geldiği
  pluginId?: string
}
