export type SkillScope = "project" | "global" | "plugin" | "mcp"

// Identifies the directory or runtime that supplied the skill.
export type SkillOrigin =
  | "codezal"
  | "agents"
  | "agent"
  | "codex"
  | "claude"
  | "plugin"
  | "mcp"

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
