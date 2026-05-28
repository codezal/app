// Marketplace yönetimi — GitHub URL'den clone/pull, index.json fetch, plugin manifest okuma.
import { Command } from "@tauri-apps/plugin-shell"
import { exists, mkdir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import {
  parseMarketplaceIndex,
  parseMarketplacePluginManifest,
} from "./manifest"
import {
  readMarketplaces,
  upsertMarketplace,
  removeMarketplaceRegistration,
} from "./installed"
import type {
  MarketplaceIndex,
  MarketplacePluginManifest,
  RegisteredMarketplace,
} from "./types"

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// Cross-platform timeout wrapper. Linux'ta `timeout`, macOS Homebrew'de `gtimeout`,
// ikisi de yoksa komut direkt çalışır (git kendi network timeout'una bırakılır).
function withTimeout(cmd: string, secs: number): string {
  return `T="$(command -v timeout || command -v gtimeout || true)"; \${T:+$T ${secs} }${cmd}`
}

async function marketplacesRoot(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal/marketplaces"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

// URL'den marketplace id türet — basit slug.
function idFromUrl(url: string): string {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/i)
  if (m) return `${m[1]}-${m[2]}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase()
  return url.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 64)
}

// Marketplace ekle — clone veya mevcut localPath'i kullan.
// Index.json'u parse edip name'i alır, registry'ye yazar.
export async function addMarketplace(url: string): Promise<RegisteredMarketplace> {
  if (!url || !/^https?:\/\/|^git@/.test(url)) {
    throw new Error("Geçerli bir Git URL gerekli (https:// veya git@)")
  }
  const id = idFromUrl(url)
  const root = await marketplacesRoot()
  const localPath = root + "/" + id

  if (!(await exists(localPath))) {
    const cmd = `git clone --depth 1 ${shellQuote(url)} ${shellQuote(localPath)}`
    const r = await Command.create("bash", ["-lc", withTimeout(cmd, 120)]).execute()
    if (r.code !== 0) {
      throw new Error(`Marketplace clone başarısız: ${r.stderr.trim() || r.stdout.trim()}`)
    }
  } else {
    // Mevcut clone'u güncelle
    await pullMarketplace(localPath)
  }

  // Index.json'u parse et — name al
  const indexPath = localPath + "/index.json"
  if (!(await exists(indexPath))) {
    throw new Error("Marketplace repo'sunda index.json bulunamadı")
  }
  let index: MarketplaceIndex
  try {
    index = parseMarketplaceIndex(await readTextFile(indexPath))
  } catch (e) {
    throw new Error(`Marketplace index parse: ${(e as Error).message}`)
  }

  const reg: RegisteredMarketplace = {
    id,
    name: index.name,
    url,
    localPath,
    addedAt: Date.now(),
    lastPulledAt: Date.now(),
  }
  await upsertMarketplace(reg)
  return reg
}

// Marketplace'i pull et (mevcut clone'u güncelle).
export async function pullMarketplace(localPath: string): Promise<void> {
  const cmd = `cd ${shellQuote(localPath)} && git fetch --depth 1 && git reset --hard origin/HEAD`
  const r = await Command.create("bash", ["-lc", withTimeout(cmd, 120)]).execute()
  if (r.code !== 0) {
    throw new Error(`Marketplace pull başarısız: ${r.stderr.trim()}`)
  }
}

// Marketplace'i registry'den ve disk'ten çıkar.
export async function removeMarketplace(id: string): Promise<void> {
  const store = await readMarketplaces()
  const mp = store.marketplaces.find((m) => m.id === id)
  if (!mp) return
  if (await exists(mp.localPath)) {
    await Command.create("bash", [
      "-lc",
      `rm -rf ${shellQuote(mp.localPath)}`,
    ]).execute()
  }
  await removeMarketplaceRegistration(id)
}

// Marketplace index'ini oku — UI plugin listesi için.
export async function readMarketplaceIndex(
  localPath: string,
): Promise<MarketplaceIndex> {
  const indexPath = localPath + "/index.json"
  return parseMarketplaceIndex(await readTextFile(indexPath))
}

// Per-plugin manifest oku — install onay modal'ı için.
export async function readMarketplacePluginManifest(
  marketplaceLocalPath: string,
  manifestPath: string,
): Promise<MarketplacePluginManifest> {
  const full = marketplaceLocalPath + "/" + manifestPath
  return parseMarketplacePluginManifest(await readTextFile(full))
}

export { readMarketplaces } from "./installed"

// İlk açılış seed'i — kullanıcının hiç marketplace'i yoksa Codezal resmi marketplace'ini
// otomatik clone et. Kullanıcı kasten silmişse yeniden eklenmez (boşluk şartı).
const DEFAULT_MARKETPLACE_URL = "https://github.com/codezal/marketplace"

export async function ensureDefaultMarketplace(): Promise<void> {
  const store = await readMarketplaces()
  if (store.marketplaces.length > 0) return
  try {
    await addMarketplace(DEFAULT_MARKETPLACE_URL)
  } catch (e) {
    console.warn("Default marketplace seed başarısız:", (e as Error).message)
  }
}
