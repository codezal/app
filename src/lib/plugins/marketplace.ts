import { runProgram } from "@/lib/exec"
import { exists, mkdir, readTextFile, remove } from "@tauri-apps/plugin-fs"
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
import { appendAudit } from "./audit"
import { withLock } from "../lock"
import type {
  MarketplaceIndex,
  MarketplacePluginManifest,
  RegisteredMarketplace,
} from "./types"

function repoCacheKey(localPath: string): string {
  return `repo-cache:${localPath}`
}

//   https://github.com/o/r.git , git@github.com:o/r , ssh://git@github.com/o/r → "github.com/o/r"
function normalizeRemote(url: string): string {
  let s = url.trim().replace(/\.git\/?$/, "").replace(/\/+$/, "")
  s = s.replace(/^https?:\/\//i, "").replace(/^ssh:\/\//i, "")
  s = s.replace(/^git@/i, "")
  s = s.replace(/^([^/]+):/, "$1/") // host:path → host/path
  return s.toLowerCase()
}

async function marketplacesRoot(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal/marketplaces"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

function idFromUrl(url: string): string {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/i)
  if (m) return `${m[1]}-${m[2]}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase()
  return url.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 64)
}

export const DEFAULT_MARKETPLACE_URL = "https://github.com/codezal/marketplace"
export const DEFAULT_MARKETPLACE_ID = idFromUrl(DEFAULT_MARKETPLACE_URL)

export async function addMarketplace(url: string): Promise<RegisteredMarketplace> {
  if (!url || !/^https?:\/\/|^git@/.test(url)) {
    throw new Error("Geçerli bir Git URL gerekli (https:// veya git@)")
  }
  const id = idFromUrl(url)
  const root = await marketplacesRoot()
  const localPath = root + "/" + id

  await withLock(repoCacheKey(localPath), async () => {
    if (!(await exists(localPath))) {
      const r = await runProgram("git", ["clone", "--depth", "1", url, localPath], {
        timeoutMs: 120_000,
        env: { GIT_LFS_SKIP_SMUDGE: "1" },
      })
      if (r.code !== 0) {
        throw new Error(`Marketplace clone başarısız: ${r.stderr.trim() || r.stdout.trim()}`)
      }
    } else {
      await pullMarketplaceCore(localPath, url)
    }
  })

  // Index.json'u parse et — name al
  const indexPath = localPath + "/index.json"
  if (!(await exists(indexPath))) {
    throw new Error("Marketplace repo'sunda index.json bulunamadı")
  }
  let index: MarketplaceIndex
  try {
    index = parseMarketplaceIndex(await readTextFile(indexPath))
  } catch (e) {
    throw new Error(`Marketplace index parse: ${(e as Error).message}`, { cause: e })
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
  await appendAudit({
    ts: Date.now(),
    event: "marketplace-add",
    marketplace: url,
    detail: index.name,
  })
  return reg
}

async function pullMarketplaceCore(localPath: string, expectedUrl?: string): Promise<void> {
  if (expectedUrl) {
    const og = await runProgram("git", ["config", "--get", "remote.origin.url"], {
      cwd: localPath,
    })
    const actual = og.code === 0 ? og.stdout.trim() : ""
    if (actual && normalizeRemote(actual) !== normalizeRemote(expectedUrl)) {
      throw new Error(
        `Marketplace pull reddedildi: ${localPath} origin'i (${actual}) beklenen repo (${expectedUrl}) ile eşleşmiyor`,
      )
    }
  }
  const fetch = await runProgram("git", ["fetch", "--depth", "1", "origin", "HEAD"], {
    cwd: localPath,
    timeoutMs: 120_000,
  })
  if (fetch.code !== 0) {
    throw new Error(`Marketplace pull başarısız: ${fetch.stderr.trim()}`)
  }
  const reset = await runProgram("git", ["reset", "--hard", "FETCH_HEAD"], {
    cwd: localPath,
    env: { GIT_LFS_SKIP_SMUDGE: "1" },
  })
  if (reset.code !== 0) {
    throw new Error(`Marketplace pull başarısız: ${reset.stderr.trim()}`)
  }
}

export async function pullMarketplace(localPath: string, expectedUrl?: string): Promise<void> {
  await withLock(repoCacheKey(localPath), () => pullMarketplaceCore(localPath, expectedUrl))
}

export async function removeMarketplace(id: string): Promise<void> {
  if (id === DEFAULT_MARKETPLACE_ID) {
    throw new Error("Codezal marketplace kaldırılamaz")
  }
  const store = await readMarketplaces()
  const mp = store.marketplaces.find((m) => m.id === id)
  if (!mp) return
  if (await exists(mp.localPath)) {
    await remove(mp.localPath, { recursive: true }).catch(() => {})
  }
  await removeMarketplaceRegistration(id)
  await appendAudit({
    ts: Date.now(),
    event: "marketplace-remove",
    marketplace: mp.url,
    detail: mp.name,
  })
}

export async function readMarketplaceIndex(
  localPath: string,
): Promise<MarketplaceIndex> {
  const indexPath = localPath + "/index.json"
  return parseMarketplaceIndex(await readTextFile(indexPath))
}

export async function readMarketplacePluginManifest(
  marketplaceLocalPath: string,
  manifestPath: string,
): Promise<MarketplacePluginManifest> {
  const full = marketplaceLocalPath + "/" + manifestPath
  return parseMarketplacePluginManifest(await readTextFile(full))
}

export { readMarketplaces } from "./installed"

export async function ensureDefaultMarketplace(): Promise<void> {
  const store = await readMarketplaces()
  if (store.marketplaces.some((m) => m.id === DEFAULT_MARKETPLACE_ID)) return
  try {
    await addMarketplace(DEFAULT_MARKETPLACE_URL)
  } catch (e) {
    console.warn("Default marketplace seed başarısız:", (e as Error).message)
  }
}
