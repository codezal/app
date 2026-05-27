// Agent registry — workspace + user + plugin birleşimi.
import { readWorkspaceAgents, readUserAgents } from "./user"
import { listPluginAgents } from "./plugin"
import type { AgentDef } from "./types"

// findAgent — verilen isimde agent'ı bul (project > global > plugin sırası).
// Aynı isimde birden çok agent varsa workspace > user > plugin önceliği.
export async function findAgent(
  workspace: string | undefined,
  name: string,
): Promise<AgentDef | null> {
  const [proj, user] = await Promise.all([
    readWorkspaceAgents(workspace),
    readUserAgents(),
  ])
  const plugin = listPluginAgents()
  return (
    proj.find((a) => a.name === name) ??
    user.find((a) => a.name === name) ??
    plugin.find((a) => a.name === name) ??
    null
  )
}

// Tüm agent'ları listele — UI ve catalog için.
export async function listAllAgents(workspace: string | undefined): Promise<AgentDef[]> {
  const [proj, user] = await Promise.all([
    readWorkspaceAgents(workspace),
    readUserAgents(),
  ])
  return [...proj, ...user, ...listPluginAgents()]
}

export { readWorkspaceAgents, readUserAgents, readAgentsDir } from "./user"
export { parseAgentFile, checkSubagentPolicy, buildAgentsCatalog } from "./parse"
export {
  listPluginAgents,
  _registerPluginAgent,
  _unregisterPluginAgents,
  _clearPluginAgents,
} from "./plugin"
export type { AgentDef, AgentScope, SubagentPolicy } from "./types"
