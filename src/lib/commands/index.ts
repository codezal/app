// Slash komut registry — builtin + user (workspace + global) + plugin birleşimi.
// Caller: Composer/CommandPalette → listAllCommands(workspace) → tüm komutlar.
import { BUILTINS } from "./builtin"
import { readWorkspaceCommands, readUserCommands } from "./user"
import { listPluginCommands } from "./plugin"
import type { SlashCommand } from "./types"

export async function listAllCommands(
  workspace: string | undefined,
): Promise<SlashCommand[]> {
  const [proj, user] = await Promise.all([
    readWorkspaceCommands(workspace),
    readUserCommands(),
  ])
  return [...BUILTINS, ...proj, ...user, ...listPluginCommands()]
}

export { BUILTINS } from "./builtin"
export { parseSlashInput, renderTemplate, parseCommandFile } from "./parse"
export { readWorkspaceCommands, readUserCommands } from "./user"
export {
  listPluginCommands,
  _registerPluginCommand,
  _unregisterPluginCommands,
  _clearPluginCommands,
} from "./plugin"
export type { SlashCommand, SlashScope, SlashAction } from "./types"
