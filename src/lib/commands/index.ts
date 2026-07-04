import { BUILTINS } from "./builtin"
import { readWorkspaceCommands, readUserCommands } from "./user"
import { readWorkspaceWorkflows, readUserWorkflows } from "./workflow"
import { listPluginCommands } from "./plugin"
import { listAllSkills } from "../skills"
import { useSettingsStore } from "@/store/settings"
import type { SlashCommand } from "./types"

// Drop later duplicates by name — first occurrence wins. Lets callers encode
// precedence purely through array order.
export function dedupeCommands(cmds: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>()
  const out: SlashCommand[] = []
  for (const c of cmds) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
  }
  return out
}

async function skillCommands(
  workspace: string | undefined,
): Promise<SlashCommand[]> {
  const all = await listAllSkills(workspace)
  const disabled = new Set(useSettingsStore.getState().settings.disabledSkills ?? [])
  return all
    .filter((s) => !disabled.has(s.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      scope: "skill" as const,
      template: s.body,
      needsArg: false,
      path: s.path,
    }))
}

export async function listAllCommands(
  workspace: string | undefined,
): Promise<SlashCommand[]> {
  const [proj, user, wfProj, wfUser, skills] = await Promise.all([
    readWorkspaceCommands(workspace),
    readUserCommands(),
    readWorkspaceWorkflows(workspace),
    readUserWorkflows(),
    skillCommands(workspace),
  ])
  // Precedence: builtin > project > global > workflow > plugin > skill.
  return dedupeCommands([
    ...BUILTINS,
    ...proj,
    ...user,
    ...wfProj,
    ...wfUser,
    ...listPluginCommands(),
    ...skills,
  ])
}

export { BUILTINS } from "./builtin"
export { parseSlashInput, renderTemplate, parseCommandFile, templateHasArgs } from "./parse"
export { readWorkspaceCommands, readUserCommands } from "./user"
export {
  listPluginCommands,
  _registerPluginCommand,
  _unregisterPluginCommands,
  _clearPluginCommands,
} from "./plugin"
export type { SlashCommand, SlashScope, SlashAction } from "./types"
