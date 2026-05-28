// Plugin kaynaklı slash komutlar — plugins/loader.ts runtime'da register eder.
// PluginManager enable/disable değişimine göre listeyi günceller.
import type { SlashCommand } from "./types"

const pluginCommands: SlashCommand[] = []

// Plugin registry değişince UI'a haber ver — Composer/CommandPalette dinler.
function notifyCommandsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codezal:commands-changed"))
  }
}

export function listPluginCommands(): SlashCommand[] {
  return [...pluginCommands]
}

export function _registerPluginCommand(c: SlashCommand): void {
  // Aynı isim + pluginId varsa override
  const idx = pluginCommands.findIndex(
    (x) => x.name === c.name && x.pluginId === c.pluginId,
  )
  if (idx >= 0) pluginCommands.splice(idx, 1, c)
  else pluginCommands.push(c)
  notifyCommandsChanged()
}

export function _unregisterPluginCommands(pluginId: string): void {
  let changed = false
  for (let i = pluginCommands.length - 1; i >= 0; i--) {
    if (pluginCommands[i].pluginId === pluginId) {
      pluginCommands.splice(i, 1)
      changed = true
    }
  }
  if (changed) notifyCommandsChanged()
}

export function _clearPluginCommands(): void {
  if (pluginCommands.length === 0) return
  pluginCommands.length = 0
  notifyCommandsChanged()
}
