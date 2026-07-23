export type SlashScope = "builtin" | "project" | "global" | "plugin" | "mcp" | "skill"

export type SlashAction =
  | "clear"
  | "branch"
  | "fork"
  | "model"
  | "agent"
  | "workspace"
  | "help"
  | "stop"
  | "search"
  | "routines"
  | "settings"
  | "orchestra"
  | "plugins"
  | "goal"
  | "codemap-index"
  | "memory"
  | "rename"
  | "resume"
  | "compact"
  | "side-chat"
  | "sdd"

export type SlashCommand = {
  name: string
  description: string
  scope: SlashScope
  // Prompt template (user-defined/plugin) ya da action key (builtin)
  template?: string
  action?: SlashAction
  needsArg?: boolean
  path?: string
  // Per-command overrides (frontmatter). agent → spawn that agent in the
  // right panel; subtask → spawn a generic sub-agent; model → run this turn
  // on a specific model ("provider/id" or bare id, provider stays the
  // session's). agent/subtask take precedence over model.
  agent?: string
  model?: string
  subtask?: boolean
  // Tools the model may NOT use on this command's turn (frontmatter
  // `disallowed-tools`). Removed from the tool set in runStream before streaming.
  disallowedTools?: string[]
  pluginId?: string
  mcpServer?: string
  mcpPrompt?: string
}
