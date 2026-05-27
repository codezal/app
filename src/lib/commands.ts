// Re-export shim — commands/ dizinine taşındı. Geriye uyumluluk için public API
// aynı isim/imzayla korunur. Yeni kod doğrudan "@/lib/commands/index"den import edebilir.
export {
  BUILTINS,
  listAllCommands,
  parseSlashInput,
  renderTemplate,
  readWorkspaceCommands,
  readUserCommands,
} from "./commands/index"
export type { SlashCommand, SlashScope } from "./commands/types"
