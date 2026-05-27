// Plugin kaynaklı slash komutlar — plugins/loader.ts runtime'da register eder.
// PluginManager enable/disable değişimine göre listeyi günceller.
import type { SlashCommand } from "./types"

const pluginCommands: SlashCommand[] = []

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
}

export function _unregisterPluginCommands(pluginId: string): void {
  for (let i = pluginCommands.length - 1; i >= 0; i--) {
    if (pluginCommands[i].pluginId === pluginId) {
      pluginCommands.splice(i, 1)
    }
  }
}

export function _clearPluginCommands(): void {
  pluginCommands.length = 0
}
