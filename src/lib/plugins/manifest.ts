import type {
  MarketplaceIndex,
  MarketplacePluginManifest,
  Permission,
  PluginManifest,
} from "./types"

const VALID_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "filesystem.read",
  "filesystem.write",
  "shell.exec",
  "git.exec",
  "network.fetch",
  "agents.register",
  "commands.register",
  "skills.register",
  "mcp.register",
  "hooks.register",
  "providers.register",
])

function isSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)
}

function isKebab(s: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(s)
}

export function parsePluginManifest(raw: string): PluginManifest {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Plugin manifest JSON parse hatası: ${(e as Error).message}`, { cause: e })
  }
  if (!json || typeof json !== "object") {
    throw new Error("Plugin manifest objesi geçersiz")
  }
  const o = json as Record<string, unknown>
  if (typeof o.name !== "string" || !isKebab(o.name)) {
    throw new Error(`Plugin name kebab-case olmalı (a-z0-9-): "${o.name}"`)
  }
  if (typeof o.version !== "string" || !isSemver(o.version)) {
    throw new Error(`Plugin version semver olmalı: "${o.version}"`)
  }
  if (typeof o.description !== "string") {
    throw new Error("Plugin description zorunlu")
  }
  if (typeof o.license !== "string" || o.license.trim() === "") {
    throw new Error("Plugin license zorunlu (SPDX id)")
  }
  if (
    !o.author ||
    typeof o.author !== "object" ||
    typeof (o.author as Record<string, unknown>).name !== "string"
  ) {
    throw new Error("Plugin author.name zorunlu")
  }
  if (!Array.isArray(o.permissions)) {
    throw new Error("Plugin permissions array (boş olabilir) zorunlu")
  }
  for (const p of o.permissions) {
    if (typeof p !== "string" || !VALID_PERMISSIONS.has(p as Permission)) {
      throw new Error(`Geçersiz permission: "${p}"`)
    }
  }
  if (!o.contributes || typeof o.contributes !== "object") {
    throw new Error("Plugin contributes objesi zorunlu (boş olabilir)")
  }
  if (o.network !== undefined) {
    if (typeof o.network !== "object" || o.network === null) {
      throw new Error("Plugin network bloğu obje olmalı")
    }
    const net = o.network as Record<string, unknown>
    if (!Array.isArray(net.allowedHosts) || net.allowedHosts.some((h) => typeof h !== "string")) {
      throw new Error("network.allowedHosts string dizisi olmalı")
    }
  }
  if (o.signature !== undefined && typeof o.signature !== "string") {
    throw new Error("signature base64 string olmalı")
  }
  if (o.requires !== undefined) {
    if (typeof o.requires !== "object" || o.requires === null) {
      throw new Error("requires bloğu obje olmalı")
    }
    const req = o.requires as Record<string, unknown>
    if (req.codezalMinVersion !== undefined) {
      if (typeof req.codezalMinVersion !== "string" || !isSemver(req.codezalMinVersion)) {
        throw new Error(`requires.codezalMinVersion semver olmalı: "${req.codezalMinVersion}"`)
      }
    }
  }
  return json as PluginManifest
}

export function satisfiesMinVersion(current: string, min: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const c = parse(current)
  const n = parse(min)
  if (!c || !n) return false
  for (let i = 0; i < 3; i++) {
    if (c[i] > n[i]) return true
    if (c[i] < n[i]) return false
  }
  return true
}

export function parseMarketplacePluginManifest(raw: string): MarketplacePluginManifest {
  const base = parsePluginManifest(raw)
  const o = JSON.parse(raw) as Record<string, unknown>
  const channel = o.channel
  if (channel !== "codezal-curated" && channel !== "community" && channel !== "local") {
    throw new Error(`Geçersiz channel: "${channel}"`)
  }
  if (typeof o.verified !== "boolean") {
    throw new Error("verified bool zorunlu")
  }
  if (!o.source || typeof o.source !== "object") {
    throw new Error("source objesi zorunlu")
  }
  const src = o.source as Record<string, unknown>
  if (src.type !== "git-subdir" && src.type !== "git-repo" && src.type !== "inline" && src.type !== "local") {
    throw new Error(`Geçersiz source.type: "${src.type}"`)
  }
  if (src.type === "git-subdir" || src.type === "git-repo") {
    if (typeof src.repo !== "string" || typeof src.sha !== "string") {
      throw new Error("git source: repo + sha zorunlu")
    }
    if (src.type === "git-subdir" && typeof src.path !== "string") {
      throw new Error("git-subdir: path zorunlu")
    }
  }
  return { ...base, ...(o as object) } as MarketplacePluginManifest
}

export function parseMarketplaceIndex(raw: string): MarketplaceIndex {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Marketplace index parse hatası: ${(e as Error).message}`, { cause: e })
  }
  if (!json || typeof json !== "object") throw new Error("Index objesi geçersiz")
  const o = json as Record<string, unknown>
  if (typeof o.version !== "number") throw new Error("Index version eksik")
  if (typeof o.name !== "string") throw new Error("Index name eksik")
  if (!Array.isArray(o.plugins)) throw new Error("Index plugins array eksik")
  for (const p of o.plugins) {
    if (!p || typeof p !== "object") throw new Error("Plugin entry obje değil")
    const e = p as Record<string, unknown>
    if (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.manifestPath !== "string") {
      throw new Error("Plugin entry eksik alan")
    }
  }
  return json as MarketplaceIndex
}
