// Permission motoru barrel — opencode declarative izin modelinin Codezal portu.

export type { PermissionAction, PermissionRule, Ruleset } from "./types"
export { evaluate, merge } from "./engine"
export { fromConfig, type PermissionConfig } from "./config"
export { defaultsRuleset, modePresetRuleset, agentModeRuleset } from "./presets"
export { subjectFor } from "./subject"
export { legacyRulesToRuleset } from "./legacy"
