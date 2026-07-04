export type SkillScope = "project" | "global" | "plugin" | "mcp"

// .codezal/skills → "codezal", .agents/skills → "agents", plugin loader → "plugin",
export type SkillOrigin = "codezal" | "agents" | "plugin" | "mcp"

export type Skill = {
  name: string
  description: string
  path: string // SKILL.md tam yolu
  dir: string
  scope: SkillScope
  origin: SkillOrigin
  triggers?: string[]
  body: string
  bytes: number
  pluginId?: string
  mcpServer?: string
}
