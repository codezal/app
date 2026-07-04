import { exists, mkdir, readTextFile, writeTextFile, rename } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { withLock } from "../lock"
import type { InstalledPlugin, RegisteredMarketplace } from "./types"

const INSTALLED_LOCK = "registry:installed"
const MARKETPLACES_LOCK = "registry:marketplaces"

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = path + ".tmp"
  await writeTextFile(tmp, JSON.stringify(data, null, 2))
  await rename(tmp, path)
}

async function rootDir(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

async function installedPath(): Promise<string> {
  return (await rootDir()) + "/installed_plugins.json"
}

async function marketplacesPath(): Promise<string> {
  return (await rootDir()) + "/marketplaces.json"
}

export type InstalledStore = {
  version: number
  plugins: InstalledPlugin[]
}

const EMPTY: InstalledStore = { version: 1, plugins: [] }

export async function readInstalled(): Promise<InstalledStore> {
  const p = await installedPath()
  if (!(await exists(p))) return { ...EMPTY }
  try {
    const raw = await readTextFile(p)
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object" || !Array.isArray(j.plugins)) {
      return { ...EMPTY }
    }
    return j as InstalledStore
  } catch {
    return { ...EMPTY }
  }
}

export async function writeInstalled(store: InstalledStore): Promise<void> {
  await writeJsonAtomic(await installedPath(), store)
}

export async function upsertInstalled(plugin: InstalledPlugin): Promise<void> {
  await withLock(INSTALLED_LOCK, async () => {
    const s = await readInstalled()
    const idx = s.plugins.findIndex((x) => x.id === plugin.id)
    if (idx >= 0) s.plugins[idx] = plugin
    else s.plugins.push(plugin)
    await writeInstalled(s)
  })
}

export async function removeInstalled(pluginId: string): Promise<void> {
  await withLock(INSTALLED_LOCK, async () => {
    const s = await readInstalled()
    s.plugins = s.plugins.filter((p) => p.id !== pluginId)
    await writeInstalled(s)
  })
}

export async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await withLock(INSTALLED_LOCK, async () => {
    const s = await readInstalled()
    const p = s.plugins.find((x) => x.id === pluginId)
    if (!p) return
    p.enabled = enabled
    await writeInstalled(s)
  })
}

// Marketplace registry

export type MarketplaceStore = {
  version: number
  marketplaces: RegisteredMarketplace[]
}

const EMPTY_MP: MarketplaceStore = { version: 1, marketplaces: [] }

export async function readMarketplaces(): Promise<MarketplaceStore> {
  const p = await marketplacesPath()
  if (!(await exists(p))) return { ...EMPTY_MP }
  try {
    const raw = await readTextFile(p)
    const j = JSON.parse(raw)
    if (!j || typeof j !== "object" || !Array.isArray(j.marketplaces)) {
      return { ...EMPTY_MP }
    }
    return j as MarketplaceStore
  } catch {
    return { ...EMPTY_MP }
  }
}

export async function writeMarketplaces(store: MarketplaceStore): Promise<void> {
  await writeJsonAtomic(await marketplacesPath(), store)
}

export async function upsertMarketplace(mp: RegisteredMarketplace): Promise<void> {
  await withLock(MARKETPLACES_LOCK, async () => {
    const s = await readMarketplaces()
    const idx = s.marketplaces.findIndex((x) => x.id === mp.id)
    if (idx >= 0) s.marketplaces[idx] = mp
    else s.marketplaces.push(mp)
    await writeMarketplaces(s)
  })
}

export async function removeMarketplaceRegistration(id: string): Promise<void> {
  await withLock(MARKETPLACES_LOCK, async () => {
    const s = await readMarketplaces()
    s.marketplaces = s.marketplaces.filter((m) => m.id !== id)
    await writeMarketplaces(s)
  })
}
