// Plugin sistemi ortak contract'ları.
import type { ProviderId } from "../providers/types"
import type { McpServerConfig } from "../mcp"
import type { HookConfig } from "@/store/types"

// Permission model — plugin manifest'inde zorunlu alan. Loader register sırasında
// kontrol eder; izni olmayan contribute alanı sessizce atlanır + console.warn.
// Sandbox modeli (Faz 3, JS entry) bu permission setini runtime'da uygular.
export type Permission =
  | "filesystem.read"
  | "filesystem.write"
  | "shell.exec"
  | "git.exec"
  | "network.fetch"
  | "agents.register"
  | "commands.register"
  | "skills.register"
  | "mcp.register"
  | "hooks.register"
  | "providers.register"

export function isHighRisk(p: Permission): boolean {
  return [
    "shell.exec",
    "filesystem.write",
    "mcp.register",
    "hooks.register",
    "providers.register",
  ].includes(p)
}

// Permission açıklamaları — UI install onay modal'ında gösterilir.
export const PERMISSION_LABELS: Record<Permission, string> = {
  "filesystem.read": "Dosya okuma",
  "filesystem.write": "Dosya yazma",
  "shell.exec": "Bash komut çalıştırma",
  "git.exec": "Git komutları çalıştırma",
  "network.fetch": "HTTP isteği",
  "agents.register": "Agent ekleme",
  "commands.register": "Slash komut ekleme",
  "skills.register": "Skill ekleme",
  "mcp.register": "MCP server ekleme (binary spawn riski)",
  "hooks.register": "Hook ekleme (bash spawn riski)",
  "providers.register": "LLM provider ekleme (Faz 3)",
}

// Plugin manifest — .codezal-plugin/plugin.json içeriği.
export type PluginManifest = {
  name: string // kebab-case, [a-z0-9-]+
  version: string // semver
  description: string
  license: string // SPDX id
  author: { name: string; email?: string; url?: string }
  upstream?: string // upstream repo URL
  attribution?: {
    originalAuthor: string
    originalRepo: string
    modified: boolean
    notice?: string
  }
  permissions: Permission[]
  contributes: {
    agents?: string[] // dosya yolu pattern'leri (örn "agents/*.md")
    skills?: string[] // dizin yolu (örn "skills/<name>")
    commands?: string[]
    mcps?: McpServerConfig[]
    hooks?: HookConfig[]
    providers?: { entry: string }[] // Faz 3: JS file path
  }
  requires?: { codezalMinVersion: string }
}

// Plugin kaynak tipi — marketplace index'inden gelir.
export type PluginSource =
  | {
      type: "git-subdir"
      repo: string // "owner/repo"
      path: string // repo içi alt dizin
      sha: string // pin
      ref?: string // branch/tag (clone için)
    }
  | {
      type: "git-repo"
      repo: string
      sha: string
      ref?: string
    }
  | {
      type: "inline"
      // marketplace repo içindeki path
      path: string
    }
  | {
      type: "local"
      // kullanıcının kendi disk'indeki path (geliştirme için)
      absolutePath: string
    }

export type Channel = "codezal-curated" | "community" | "local"

// Marketplace index.json'daki tek satır.
export type MarketplaceIndexEntry = {
  id: string // "<name>@<channel>"
  name: string
  channel: Channel
  verified: boolean
  manifestPath: string // index.json'a göre relative
}

export type MarketplaceIndex = {
  version: number
  name: string
  updatedAt?: string
  plugins: MarketplaceIndexEntry[]
}

// Marketplace plugin manifest (per-plugin <name>.json) — source bloğu içerir.
export type MarketplacePluginManifest = PluginManifest & {
  channel: Channel
  verified: boolean
  source: PluginSource
  tags?: string[]
}

// Kayıtlı marketplace — ~/.codezal/marketplaces.json
export type RegisteredMarketplace = {
  id: string
  name: string
  // GitHub URL veya yerel path
  url: string
  // Clone edilmiş yer (HOME/.codezal/marketplaces/<id>)
  localPath: string
  addedAt: number
  lastPulledAt?: number
}

// Kurulu plugin kaydı — ~/.codezal/installed_plugins.json
export type InstalledPlugin = {
  id: string // "name@channel"
  name: string
  version: string
  channel: Channel
  marketplaceId: string
  source: PluginSource
  installPath: string // ~/.codezal/plugins/<name>/
  enabled: boolean
  installedAt: number
  lastUpdatedAt?: number
  pinnedSha?: string
  manifest: PluginManifest
}

// PluginAPI — plugin loader runtime'da bunu wrapper olarak verir.
// Plugin permission setine sahip değilse register* metodları sessizce no-op'a düşer + warn.
// Faz 3'te JS entry geldiğinde plugin kodu doğrudan bu interface'i alır.
export interface PluginAPI {
  registerProvider?(p: {
    id: ProviderId
    label: string
    defaultModel: string
    fallbackModels: string[]
    buildModel: (modelId: string, apiKey: string) => unknown
  }): void
  registerCommand(c: {
    name: string
    description: string
    template?: string
    needsArg?: boolean
  }): void
  registerAgent(a: {
    name: string
    description: string
    systemPrompt: string
    model?: string
    provider?: ProviderId
    tools?: string[]
  }): void
  registerSkill(s: {
    name: string
    description: string
    body: string
    triggers?: string[]
  }): void
  registerMcp(m: McpServerConfig): void
  registerHook(h: HookConfig): void
}

export type LoadResult = {
  pluginId: string
  ok: boolean
  registered: {
    agents: number
    commands: number
    skills: number
    mcps: number
    hooks: number
  }
  warnings: string[]
}
