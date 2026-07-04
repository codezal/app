// Merge a project-level config override on top of the global settings.
//
// SECURITY: the project config lives at `<workspace>/.codezal/config.json` — i.e.
// inside the opened workspace, which is UNTRUSTED (it ships with any cloned/
// downloaded repo). Therefore only benign keys (provider/model) are layered from
// it. Security-sensitive keys (hooks, approvalMode, approvalRules, mcpServers) are
// IGNORED from project scope — applying them would let a malicious repo execute
// code without consent (a PreToolUse hook runs `runShell` before the approval gate
// and even for read-only tools; a stdio mcpServer is spawned on connect) or disable
// the safety gate (approvalMode "bypass" / auto-allow approvalRules). Those may only
// be set in GLOBAL, user-authored settings.
//
// Future: allow project overrides for these keys once the user explicitly marks a
// workspace as trusted (à la VS Code Workspace Trust).

import type { Settings } from "@/store/types"
import type { ProjectConfig } from "./schema"
import { DEFAULT_MEMORY } from "@/lib/memory-settings"

const BLOCKED_PROJECT_KEYS = ["hooks", "approvalMode", "approvalRules", "permission", "mcpServers"] as const

function isProjectSafeInstruction(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return false // remote URL
  if (s.startsWith("~")) return false // home-relative
  // POSIX absolute (/...), Windows drive (C:\ veya C:/), UNC (\\server)
  if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(s)) return false
  return true
}

// Produce the effective settings for a workspace by layering its project config
// over the global settings. Returns the global object unchanged when there is
// no project config (cheap identity, safe to call on every read).
export function mergeProjectConfig(global: Settings, project: ProjectConfig | null): Settings {
  if (!project) return global

  const merged: Settings = { ...global }

  if (project.defaultProvider) merged.defaultProvider = project.defaultProvider as Settings["defaultProvider"]
  if (project.defaultModel) merged.defaultModel = project.defaultModel

  const projInstr = project.memory?.instructions
  if (Array.isArray(projInstr) && projInstr.length > 0) {
    const base = merged.memory ?? DEFAULT_MEMORY
    const safe = projInstr.filter(isProjectSafeInstruction)
    const rejected = projInstr.length - safe.length
    if (rejected > 0) {
      console.warn(
        `[config] project memory.instructions içindeki ${rejected} kaynak yok sayıldı ` +
          `(untrusted workspace): URL / absolute / ~ yol yalnızca global ayarlardan tanımlanabilir.`,
      )
    }
    if (safe.length > 0) {
      merged.memory = { ...base, instructions: [...base.instructions, ...safe] }
    }
  }

  const ignored = BLOCKED_PROJECT_KEYS.filter((k) => {
    const v = project[k]
    return Array.isArray(v) ? v.length > 0 : v != null
  })
  if (ignored.length > 0) {
    console.warn(
      `[config] project config'teki güvenlik-hassas alan(lar) yok sayıldı (untrusted workspace): ` +
        `${ignored.join(", ")} — bunları yalnızca global ayarlar tanımlayabilir.`,
    )
  }

  return merged
}
