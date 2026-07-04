import type { ProviderId } from "../providers/types"
import type { McpServerConfig } from "../mcp"
import type { HookConfig } from "@/store/types"

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
  // allowedHosts: izinli host'lar ("api.openai.com", "*.openai.com", "*").
  network?: {
    allowedHosts: string[]
  }
  contributes: {
    agents?: string[]
    skills?: string[]
    commands?: string[]
    mcps?: McpServerConfig[]
    hooks?: HookConfig[]
    providers?: { entry: string }[] // Faz 3: JS file path
  }
  signature?: string
  requires?: { codezalMinVersion: string }
}

export type PluginSource =
  | {
      type: "git-subdir"
      repo: string // "owner/repo"
      path: string
      sha: string // pin
      ref?: string
    }
  | {
      type: "git-repo"
      repo: string
      sha: string
      ref?: string
    }
  | {
      type: "inline"
      path: string
    }
  | {
      type: "local"
      absolutePath: string
    }

export type Channel = "codezal-curated" | "community" | "local"

export type MarketplaceIndexEntry = {
  id: string // "<name>@<channel>"
  name: string
  channel: Channel
  verified: boolean
  manifestPath: string
}

export type MarketplaceIndex = {
  version: number
  name: string
  updatedAt?: string
  plugins: MarketplaceIndexEntry[]
}

export type MarketplacePluginManifest = PluginManifest & {
  channel: Channel
  verified: boolean
  source: PluginSource
  tags?: string[]
}

export type RegisteredMarketplace = {
  id: string
  name: string
  // GitHub URL veya yerel path
  url: string
  localPath: string
  addedAt: number
  lastPulledAt?: number
}

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
  fingerprint?: string
  manifest: PluginManifest
}

// PluginAPI — plugin loader runtime'da bunu wrapper olarak verir.
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
  fetch?(input: string, init?: RequestInit): Promise<Response>
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
