// Plugin kaynaklı skill'ler — plugin loader register eder.
import type { Skill } from "./types"

const pluginSkills: Skill[] = []

function notify(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codezal:skills-changed"))
  }
}

export function listPluginSkills(): Skill[] {
  return [...pluginSkills]
}

export function _registerPluginSkill(s: Skill): void {
  const idx = pluginSkills.findIndex(
    (x) => x.name === s.name && x.pluginId === s.pluginId,
  )
  if (idx >= 0) pluginSkills.splice(idx, 1, s)
  else pluginSkills.push(s)
  notify()
}

export function _unregisterPluginSkills(pluginId: string): void {
  let changed = false
  for (let i = pluginSkills.length - 1; i >= 0; i--) {
    if (pluginSkills[i].pluginId === pluginId) {
      pluginSkills.splice(i, 1)
      changed = true
    }
  }
  if (changed) notify()
}

export function _clearPluginSkills(): void {
  if (pluginSkills.length === 0) return
  pluginSkills.length = 0
  notify()
}
