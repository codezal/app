// Declarative izin config'i → Ruleset. opencode permission/index.ts:288-300 portu.

import type { PermissionAction, Ruleset } from "./types"

export type PermissionConfig = Record<string, PermissionAction | Record<string, PermissionAction>>

export function fromConfig(perm: PermissionConfig | undefined): Ruleset {
  if (!perm) return []
  const out: Ruleset = []
  for (const [key, value] of Object.entries(perm)) {
    if (typeof value === "string") {
      out.push({ permission: key, pattern: "*", action: value })
    } else {
      for (const [pattern, action] of Object.entries(value)) {
        out.push({ permission: key, pattern, action })
      }
    }
  }
  return out
}
