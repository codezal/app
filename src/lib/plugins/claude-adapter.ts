// Claude Code plugin adapter — opt-in scan of `~/.claude/plugins/` and conversion
// to Codezal MarketplacePluginManifest objects with attribution metadata.
//
// Claude Code plugins live under:
//   ~/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>/
//   ~/.claude/plugins/<plugin>/                      (legacy / direct install)
//
// Each plugin directory contains a `.claude-plugin/plugin.json` manifest plus
// optional `agents/`, `commands/`, `skills/` directories of Markdown files.
// We do NOT import providers via the adapter — that requires JS execution and is
// gated by the sandbox layer (see sandbox.ts).
//
// This adapter is opt-in: callers must invoke `scanClaudeCodePlugins()` explicitly.
// Nothing is imported automatically on app boot.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type {
  Channel,
  MarketplacePluginManifest,
  Permission,
  PluginSource,
} from "./types"

const CLAUDE_PLUGINS_ROOT_REL = ".claude/plugins"

async function claudeRoot(): Promise<string> {
  const home = await homeDir()
  return home.replace(/[\\/]+$/, "") + "/" + CLAUDE_PLUGINS_ROOT_REL
}

// Minimal shape of a Claude Code `.claude-plugin/plugin.json` file.
type ClaudePluginManifest = {
  name?: string
  description?: string
  version?: string
  author?: { name?: string; email?: string; url?: string }
  license?: string
  // Claude Code does not declare a permissions array; permissions are derived
  // from the presence of agents/commands/skills/mcps directories.
}

type DiscoveredPlugin = {
  // Absolute path of the plugin directory on disk.
  pluginDir: string
  // Marketplace name as inferred from the path (or "claude-plugins" for direct).
  sourceMarketplace: string
  manifest: ClaudePluginManifest
}

// Walk the standard Claude Code layout. Returns nothing rather than throwing
// when the root is missing — Claude Code is optional.
async function discover(): Promise<DiscoveredPlugin[]> {
  const root = await claudeRoot()
  if (!(await exists(root))) return []
  const out: DiscoveredPlugin[] = []

  // 1. ~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/
  const mpRoot = root + "/marketplaces"
  if (await exists(mpRoot)) {
    for (const mpEntry of await readDir(mpRoot)) {
      if (!mpEntry.isDirectory) continue
      const pluginsDir = mpRoot + "/" + mpEntry.name + "/plugins"
      if (!(await exists(pluginsDir))) continue
      for (const pEntry of await readDir(pluginsDir)) {
        if (!pEntry.isDirectory) continue
        const pluginDir = pluginsDir + "/" + pEntry.name
        const manifest = await readClaudeManifest(pluginDir)
        if (manifest) out.push({ pluginDir, sourceMarketplace: mpEntry.name, manifest })
      }
    }
  }

  // 2. ~/.claude/plugins/<plugin>/ (legacy direct layout)
  for (const dEntry of await readDir(root)) {
    if (!dEntry.isDirectory || dEntry.name === "marketplaces") continue
    const pluginDir = root + "/" + dEntry.name
    const manifest = await readClaudeManifest(pluginDir)
    if (manifest) out.push({ pluginDir, sourceMarketplace: "claude-plugins", manifest })
  }

  return out
}

async function readClaudeManifest(
  pluginDir: string,
): Promise<ClaudePluginManifest | null> {
  const p = pluginDir + "/.claude-plugin/plugin.json"
  if (!(await exists(p))) return null
  try {
    const raw = await readTextFile(p)
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object") return null
    return j as ClaudePluginManifest
  } catch {
    return null
  }
}

// Infer the Codezal permission set from which subdirectories exist in the plugin.
// Claude Code permissions are implicit; Codezal demands an explicit list so the
// install approval UI can warn the user.
async function inferPermissions(pluginDir: string): Promise<Permission[]> {
  const perms = new Set<Permission>()
  const checks: Array<[string, Permission]> = [
    ["agents", "agents.register"],
    ["commands", "commands.register"],
    ["skills", "skills.register"],
  ]
  for (const [dir, perm] of checks) {
    if (await exists(pluginDir + "/" + dir)) perms.add(perm)
  }
  // Filesystem read is needed by any plugin that ships Markdown — we ship reads.
  perms.add("filesystem.read")
  return [...perms]
}

// Build the Codezal `contributes` block from the Claude Code on-disk layout.
async function inferContributes(
  pluginDir: string,
): Promise<MarketplacePluginManifest["contributes"]> {
  const out: MarketplacePluginManifest["contributes"] = {}
  if (await exists(pluginDir + "/agents")) out.agents = ["agents/*.md"]
  if (await exists(pluginDir + "/commands")) out.commands = ["commands/*.md"]
  if (await exists(pluginDir + "/skills")) out.skills = ["skills/*"]
  return out
}

// Convert one discovered Claude Code plugin into a MarketplacePluginManifest
// the Codezal install pipeline accepts. The source type is `local` because the
// plugin lives on disk under the user's home; nothing is cloned or copied.
export async function convertClaudeManifest(
  d: DiscoveredPlugin,
): Promise<MarketplacePluginManifest> {
  const name = (d.manifest.name ?? "claude-plugin").toLowerCase()
  const version = d.manifest.version ?? "0.0.0"
  const license = d.manifest.license ?? "UNLICENSED"
  const author = {
    name: d.manifest.author?.name ?? "Unknown",
    email: d.manifest.author?.email,
    url: d.manifest.author?.url,
  }
  const description =
    d.manifest.description ??
    `Imported from Claude Code plugins (${d.sourceMarketplace}).`
  const permissions = await inferPermissions(d.pluginDir)
  const contributes = await inferContributes(d.pluginDir)

  const channel: Channel = "local"
  const source: PluginSource = { type: "local", absolutePath: d.pluginDir }

  return {
    name,
    version,
    description,
    license,
    author,
    upstream: undefined,
    attribution: {
      originalAuthor: author.name,
      originalRepo: `~/.claude/plugins/${d.sourceMarketplace}/plugins/${name}`,
      modified: true,
      notice:
        "Imported from a Claude Code plugin via the opt-in adapter. The original " +
        "manifest carried no explicit permission set; Codezal inferred one from " +
        "the on-disk layout (agents/, commands/, skills/). Permissions involving " +
        "JS execution (providers, mcps, hooks) are intentionally NOT inferred and " +
        "must be added by hand if needed.",
    },
    permissions,
    contributes,
    channel,
    verified: false,
    source,
  }
}

// Public entry point — opt-in scan of the local Claude Code plugin directory.
// Returns one MarketplacePluginManifest per discovered plugin, ready to feed
// into `installPlugin({ marketplaceId, marketplaceLocalPath: undefined, manifest })`.
// Failures are logged and skipped rather than thrown — partial results beat zero.
export async function scanClaudeCodePlugins(): Promise<MarketplacePluginManifest[]> {
  const found = await discover()
  const out: MarketplacePluginManifest[] = []
  for (const d of found) {
    try {
      out.push(await convertClaudeManifest(d))
    } catch (e) {
      console.warn(`[claude-adapter] convert failed for ${d.pluginDir}:`, e)
    }
  }
  return out
}

// Convenience boolean — UI uses this to gate the "Import from Claude Code"
// section so it only renders when the local directory actually exists.
export async function claudeCodePluginsAvailable(): Promise<boolean> {
  return await exists(await claudeRoot())
}
