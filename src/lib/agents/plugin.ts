// Plugin kaynaklı agent'lar — plugin loader register eder.
import type { AgentDef } from "./types"

const pluginAgents: AgentDef[] = []

export function listPluginAgents(): AgentDef[] {
  return [...pluginAgents]
}

export function _registerPluginAgent(a: AgentDef): void {
  const idx = pluginAgents.findIndex(
    (x) => x.name === a.name && x.pluginId === a.pluginId,
  )
  if (idx >= 0) pluginAgents.splice(idx, 1, a)
  else pluginAgents.push(a)
}

export function _unregisterPluginAgents(pluginId: string): void {
  for (let i = pluginAgents.length - 1; i >= 0; i--) {
    if (pluginAgents[i].pluginId === pluginId) pluginAgents.splice(i, 1)
  }
}

export function _clearPluginAgents(): void {
  pluginAgents.length = 0
}
