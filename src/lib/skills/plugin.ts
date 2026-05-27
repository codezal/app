// Plugin kaynaklı skill'ler — plugin loader register eder.
import type { Skill } from "./types"

const pluginSkills: Skill[] = []

export function listPluginSkills(): Skill[] {
  return [...pluginSkills]
}

export function _registerPluginSkill(s: Skill): void {
  const idx = pluginSkills.findIndex(
    (x) => x.name === s.name && x.pluginId === s.pluginId,
  )
  if (idx >= 0) pluginSkills.splice(idx, 1, s)
  else pluginSkills.push(s)
}

export function _unregisterPluginSkills(pluginId: string): void {
  for (let i = pluginSkills.length - 1; i >= 0; i--) {
    if (pluginSkills[i].pluginId === pluginId) pluginSkills.splice(i, 1)
  }
}

export function _clearPluginSkills(): void {
  pluginSkills.length = 0
}
