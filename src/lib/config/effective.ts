// Effective settings = global settings + the active workspace's project config.
//
// Kept in its own file (rather than the barrel) because it imports the settings
// store. The store, in turn, imports only the pure config submodules
// (schema/migrate), so there is no import cycle.

import { useSettingsStore } from "@/store/settings"
import type { Settings } from "@/store/types"
import { mergeProjectConfig } from "./merge"
import { getCachedProjectConfig, loadProjectConfig } from "./project"

// Synchronous: merge the global settings with the *cached* project config for a
// workspace. If the workspace was never warmed, this is just the global
// settings (cheap, safe to call on hot paths like the pre-tool hook check).
export function getEffectiveSettings(wsPath?: string): Settings {
  const global = useSettingsStore.getState().settings
  return mergeProjectConfig(global, getCachedProjectConfig(wsPath))
}

// Warm the project-config cache for a workspace, then return effective settings.
// Call this once at the start of a send/stream so subsequent synchronous reads
// (getEffectiveSettings) see the project override.
export async function resolveEffectiveSettings(wsPath?: string): Promise<Settings> {
  await loadProjectConfig(wsPath)
  return getEffectiveSettings(wsPath)
}
