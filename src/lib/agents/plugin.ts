import type { AgentDef } from "./types"

const pluginAgents: AgentDef[] = []

function notify(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codezal:agents-changed"))
  }
}

export function listPluginAgents(): AgentDef[] {
  return [...pluginAgents]
}

export function _registerPluginAgent(a: AgentDef): void {
  const idx = pluginAgents.findIndex(
    (x) => x.name === a.name && x.pluginId === a.pluginId,
  )
  if (idx >= 0) pluginAgents.splice(idx, 1, a)
  else pluginAgents.push(a)
  notify()
}

export function _unregisterPluginAgents(pluginId: string): void {
  let changed = false
  for (let i = pluginAgents.length - 1; i >= 0; i--) {
    if (pluginAgents[i].pluginId === pluginId) {
      pluginAgents.splice(i, 1)
      changed = true
    }
  }
  if (changed) notify()
}

export function _clearPluginAgents(): void {
  if (pluginAgents.length === 0) return
  pluginAgents.length = 0
  notify()
}
