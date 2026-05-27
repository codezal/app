// Slash komut tipleri — commands/ modülünün ortak contract'ı.
export type SlashScope = "builtin" | "project" | "global" | "plugin"

export type SlashAction =
  | "clear"
  | "branch"
  | "model"
  | "agent"
  | "skill"
  | "workspace"
  | "help"
  | "stop"
  | "search"
  | "routines"
  | "settings"
  | "orchestra"
  | "agents-init"
  | "plugins"

export type SlashCommand = {
  name: string
  description: string
  scope: SlashScope
  // Prompt template (user-defined/plugin) ya da action key (builtin)
  template?: string
  action?: SlashAction
  // builtin: alt-menü açar mı (örn /model → model picker)
  needsArg?: boolean
  path?: string
  // Plugin kaynaklıysa hangi plugin'den geldiği — UI rozeti için
  pluginId?: string
}
