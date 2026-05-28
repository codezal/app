// Plugin loader — kurulu enabled plugin'leri tarar, contributes alanlarını
// permission-filtreli olarak registry'lere register eder.
// Disable edilince ya da uninstall'da _unregisterPluginX(pluginId) çağrılarak temizlenir.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { _registerPluginAgent, _unregisterPluginAgents } from "../agents/plugin"
import { parseAgentFile } from "../agents/parse"
import type { AgentDef } from "../agents/types"
import { _registerPluginSkill, _unregisterPluginSkills } from "../skills/plugin"
import { parseSkillFile } from "../skills/parse"
import type { Skill } from "../skills/types"
import {
  _registerPluginCommand,
  _unregisterPluginCommands,
} from "../commands/plugin"
import { parseCommandFile } from "../commands/parse"
import type { SlashCommand } from "../commands/types"
import { _registerPluginMcp, _unregisterPluginMcps } from "../mcp"
import { _registerPluginHook, _unregisterPluginHooks } from "../hooks"
import { _unregisterPluginProvidersByPlugin } from "../providers"
import { loadJsEntries, validateMcpCommand, validateHookCommand } from "./sandbox"
import { readInstalled } from "./installed"
import type { InstalledPlugin, LoadResult, Permission } from "./types"

function has(p: Permission, perms: Permission[]): boolean {
  return perms.includes(p)
}

// Tek plugin'i registry'lere yükle. Permission yoksa ilgili contribute atlanır.
export async function loadPlugin(plugin: InstalledPlugin): Promise<LoadResult> {
  const warnings: string[] = []
  const reg = { agents: 0, commands: 0, skills: 0, mcps: 0, hooks: 0 }
  if (!plugin.enabled) {
    return { pluginId: plugin.id, ok: true, registered: reg, warnings: ["disabled"] }
  }
  const perms = plugin.manifest.permissions
  const root = plugin.installPath.replace(/[\\/]+$/, "")

  // AGENTS
  if (plugin.manifest.contributes.agents?.length) {
    if (!has("agents.register", perms)) {
      warnings.push("agents contribute ignore (agents.register izni yok)")
    } else {
      const dir = root + "/agents"
      if (await exists(dir)) {
        try {
          for (const ent of await readDir(dir)) {
            if (!ent.name.endsWith(".md")) continue
            const fpath = dir + "/" + ent.name
            try {
              const raw = await readTextFile(fpath)
              const parsed = parseAgentFile(raw, ent.name.replace(/\.md$/, ""))
              const a: AgentDef = {
                ...parsed,
                path: fpath,
                scope: "plugin",
                pluginId: plugin.id,
              }
              _registerPluginAgent(a)
              reg.agents++
            } catch (e) {
              warnings.push(`agent ${ent.name}: ${(e as Error).message}`)
            }
          }
        } catch (e) {
          warnings.push(`agents dir okuma: ${(e as Error).message}`)
        }
      }
    }
  }

  // SKILLS
  if (plugin.manifest.contributes.skills?.length) {
    if (!has("skills.register", perms)) {
      warnings.push("skills contribute ignore (skills.register izni yok)")
    } else {
      const dir = root + "/skills"
      if (await exists(dir)) {
        try {
          for (const ent of await readDir(dir)) {
            if (!ent.isDirectory) continue
            const skillDir = dir + "/" + ent.name
            const skillFile = skillDir + "/SKILL.md"
            if (!(await exists(skillFile))) continue
            try {
              const raw = await readTextFile(skillFile)
              const parsed = parseSkillFile(raw, ent.name)
              const s: Skill = {
                ...parsed,
                path: skillFile,
                dir: skillDir,
                scope: "plugin",
                bytes: raw.length,
                pluginId: plugin.id,
              }
              _registerPluginSkill(s)
              reg.skills++
            } catch (e) {
              warnings.push(`skill ${ent.name}: ${(e as Error).message}`)
            }
          }
        } catch (e) {
          warnings.push(`skills dir okuma: ${(e as Error).message}`)
        }
      }
    }
  }

  // COMMANDS
  if (plugin.manifest.contributes.commands?.length) {
    if (!has("commands.register", perms)) {
      warnings.push("commands contribute ignore (commands.register izni yok)")
    } else {
      const dir = root + "/commands"
      if (await exists(dir)) {
        try {
          for (const ent of await readDir(dir)) {
            if (!ent.name.endsWith(".md")) continue
            const fpath = dir + "/" + ent.name
            try {
              const raw = await readTextFile(fpath)
              const parsed = parseCommandFile(raw, ent.name.replace(/\.md$/, ""))
              const c: SlashCommand = {
                name: parsed.name,
                description: parsed.description,
                scope: "plugin",
                template: parsed.template,
                needsArg:
                  parsed.template?.includes("$ARG") ||
                  parsed.template?.includes("$ARGS"),
                path: fpath,
                pluginId: plugin.id,
              }
              _registerPluginCommand(c)
              reg.commands++
            } catch (e) {
              warnings.push(`command ${ent.name}: ${(e as Error).message}`)
            }
          }
        } catch (e) {
          warnings.push(`commands dir okuma: ${(e as Error).message}`)
        }
      }
    }
  }

  // MCPS — inline JSON manifest'inde. Plugin sandbox JS register'ında uygulanan
  // command validation buraya da uygulanır — manifest path'i bypass olmamalı.
  if (plugin.manifest.contributes.mcps?.length) {
    if (!has("mcp.register", perms)) {
      warnings.push("mcp contribute ignore (mcp.register izni yok)")
    } else {
      for (const m of plugin.manifest.contributes.mcps) {
        if (m.transport === "stdio") {
          const err = validateMcpCommand(m.command ?? "", m.env)
          if (err) {
            warnings.push(`mcp "${m.name}" reddedildi: ${err}`)
            continue
          }
        }
        _registerPluginMcp({ ...m, pluginId: plugin.id })
        reg.mcps++
      }
    }
  }

  // HOOKS — inline JSON manifest'inde. Yıkıcı pattern'leri reddedilir.
  if (plugin.manifest.contributes.hooks?.length) {
    if (!has("hooks.register", perms)) {
      warnings.push("hooks contribute ignore (hooks.register izni yok)")
    } else {
      for (const h of plugin.manifest.contributes.hooks) {
        const err = validateHookCommand(h.command ?? "")
        if (err) {
          warnings.push(`hook "${h.id}" reddedildi: ${err}`)
          continue
        }
        _registerPluginHook({ ...h, pluginId: plugin.id })
        reg.hooks++
      }
    }
  }

  // PROVIDERS — JS entry. Sandbox layer guards permissions and stamps pluginId.
  // Runtime isolation is renderer-process only (see sandbox.ts threat model).
  if (plugin.manifest.contributes.providers?.length) {
    try {
      const { loaded, warnings: sw } = await loadJsEntries(plugin)
      warnings.push(...sw)
      // loadJsEntries reports loaded modules, not adapters registered; we
      // surface module count via a stable warning rather than reusing the
      // `reg` counter (which tracks Codezal-side registrations).
      if (loaded > 0) {
        warnings.push(`providers: ${loaded} JS entry/entries loaded`)
      }
    } catch (e) {
      warnings.push(`providers sandbox failed: ${(e as Error).message}`)
    }
  }

  return { pluginId: plugin.id, ok: true, registered: reg, warnings }
}

// Plugin'i tüm registry'lerden çıkar (disable/uninstall).
export function unloadPlugin(pluginId: string): void {
  _unregisterPluginAgents(pluginId)
  _unregisterPluginSkills(pluginId)
  _unregisterPluginCommands(pluginId)
  _unregisterPluginMcps(pluginId)
  _unregisterPluginHooks(pluginId)
  _unregisterPluginProvidersByPlugin(pluginId)
}

// Boot'ta tüm enabled plugin'leri yükle. App.tsx loadSettings yanında çağrılır.
export async function loadAllInstalled(): Promise<LoadResult[]> {
  const store = await readInstalled()
  const results: LoadResult[] = []
  for (const p of store.plugins) {
    try {
      const r = await loadPlugin(p)
      results.push(r)
      if (r.warnings.length > 0) {
        console.warn(`[plugin ${p.id}]`, r.warnings.join("; "))
      }
    } catch (e) {
      results.push({
        pluginId: p.id,
        ok: false,
        registered: { agents: 0, commands: 0, skills: 0, mcps: 0, hooks: 0 },
        warnings: [(e as Error).message],
      })
      console.error(`[plugin ${p.id}] load fail:`, e)
    }
  }
  return results
}
