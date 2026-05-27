// Plugin install/uninstall — source.type'a göre upstream'den çek, ~/.codezal/plugins/<name>/
// altına kopyala, LICENSE/NOTICE doğrula, installed_plugins.json güncelle.
import { Command } from "@tauri-apps/plugin-shell"
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import {
  parsePluginManifest,
} from "./manifest"
import {
  upsertInstalled,
  removeInstalled,
  readInstalled,
} from "./installed"
import { loadPlugin, unloadPlugin } from "./loader"
import type {
  InstalledPlugin,
  MarketplacePluginManifest,
  PluginSource,
} from "./types"

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

async function pluginsRoot(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal/plugins"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

// Source'a göre plugin içeriğini geçici dizine çek.
async function fetchPluginSource(
  source: PluginSource,
  marketplaceLocalPath: string | undefined,
  destDir: string,
): Promise<void> {
  if (source.type === "git-subdir" || source.type === "git-repo") {
    // Sığ clone + SHA checkout. Subdir varsa o alt yolu kopyala.
    const tmpDir = destDir + ".tmp"
    await Command.create("bash", [
      "-lc",
      `rm -rf ${shellQuote(tmpDir)}`,
    ]).execute()
    const repoUrl = source.repo.startsWith("http") || source.repo.startsWith("git@")
      ? source.repo
      : `https://github.com/${source.repo}.git`
    const cloneCmd = `git clone --filter=blob:none --no-checkout ${shellQuote(repoUrl)} ${shellQuote(tmpDir)}`
    const c = await Command.create("bash", ["-lc", `timeout 180 ${cloneCmd}`]).execute()
    if (c.code !== 0) {
      throw new Error(`git clone başarısız: ${c.stderr.trim()}`)
    }
    const checkoutCmd = `cd ${shellQuote(tmpDir)} && git checkout ${shellQuote(source.sha)}`
    const co = await Command.create("bash", ["-lc", checkoutCmd]).execute()
    if (co.code !== 0) {
      throw new Error(`SHA checkout başarısız (${source.sha}): ${co.stderr.trim()}`)
    }
    // Subdir'i destDir'e kopyala (veya tüm repo'yu)
    const srcPath = source.type === "git-subdir" ? `${tmpDir}/${source.path}` : tmpDir
    if (!(await exists(srcPath))) {
      throw new Error(`Source path bulunamadı: ${srcPath}`)
    }
    await Command.create("bash", [
      "-lc",
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(srcPath)}/. ${shellQuote(destDir)}/`,
    ]).execute()
    await Command.create("bash", ["-lc", `rm -rf ${shellQuote(tmpDir)}`]).execute()
    return
  }
  if (source.type === "inline") {
    if (!marketplaceLocalPath) {
      throw new Error("Inline source için marketplace localPath gerekli")
    }
    const srcPath = marketplaceLocalPath + "/" + source.path
    if (!(await exists(srcPath))) {
      throw new Error(`Inline source path yok: ${srcPath}`)
    }
    await Command.create("bash", [
      "-lc",
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(srcPath)}/. ${shellQuote(destDir)}/`,
    ]).execute()
    return
  }
  if (source.type === "local") {
    if (!(await exists(source.absolutePath))) {
      throw new Error(`Local source path yok: ${source.absolutePath}`)
    }
    await Command.create("bash", [
      "-lc",
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(source.absolutePath)}/. ${shellQuote(destDir)}/`,
    ]).execute()
    return
  }
  throw new Error(`Bilinmeyen source type`)
}

// Apache 2.0 plugin'leri için LICENSE+NOTICE zorunlu — yoksa install reddi.
async function verifyLicense(
  installDir: string,
  manifestLicense: string,
): Promise<void> {
  const isApache = /^Apache-?2\.0$/i.test(manifestLicense.trim())
  if (!isApache) return
  const licensePath = installDir + "/LICENSE"
  if (!(await exists(licensePath))) {
    throw new Error("Apache-2.0 plugin LICENSE dosyası içermiyor — install reddedildi")
  }
  // NOTICE Apache 2.0'da varsa korunmalı; YOKSA install yine de devam edebilir (NOTICE
  // sadece upstream NOTICE bulundurursa zorunlu). Burada uyarı verip geç.
}

// Plugin install — marketplace manifest + source çek + manifest doğrula + register.
export async function installPlugin(opts: {
  marketplaceId: string
  marketplaceLocalPath: string | undefined
  manifest: MarketplacePluginManifest
}): Promise<InstalledPlugin> {
  const { marketplaceId, marketplaceLocalPath, manifest } = opts
  const id = `${manifest.name}@${manifest.channel}`
  const root = await pluginsRoot()
  const installDir = root + "/" + manifest.name

  // Mevcutsa önce kaldır (update için)
  if (await exists(installDir)) {
    await Command.create("bash", [
      "-lc",
      `rm -rf ${shellQuote(installDir)}`,
    ]).execute()
  }

  await fetchPluginSource(manifest.source, marketplaceLocalPath, installDir)

  // Disk'teki plugin.json'u oku ve manifest ile karşılaştır — temel sanity check
  const diskManifestPath = installDir + "/.codezal-plugin/plugin.json"
  if (!(await exists(diskManifestPath))) {
    // Bazı plugin'lerde .claude-plugin/ olabilir — Faz 3 adapter ileride; şimdilik reddet
    await Command.create("bash", ["-lc", `rm -rf ${shellQuote(installDir)}`]).execute()
    throw new Error(".codezal-plugin/plugin.json bulunamadı — plugin formatı uyumsuz")
  }
  try {
    parsePluginManifest(await readTextFile(diskManifestPath))
  } catch (e) {
    await Command.create("bash", ["-lc", `rm -rf ${shellQuote(installDir)}`]).execute()
    throw new Error(`Plugin manifest doğrulama: ${(e as Error).message}`)
  }

  await verifyLicense(installDir, manifest.license)

  // Attribution NOTICE dosyası varsa ek bilgi kopyala (idempotent)
  if (manifest.attribution?.notice) {
    const noticeExtra = installDir + "/ATTRIBUTION.txt"
    if (!(await exists(noticeExtra))) {
      await writeTextFile(
        noticeExtra,
        `Source: ${manifest.attribution.originalRepo}\nOriginal author: ${manifest.attribution.originalAuthor}\nModified: ${manifest.attribution.modified}\n\n${manifest.attribution.notice}\n`,
      )
    }
  }

  const installed: InstalledPlugin = {
    id,
    name: manifest.name,
    version: manifest.version,
    channel: manifest.channel,
    marketplaceId,
    source: manifest.source,
    installPath: installDir,
    enabled: true,
    installedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    pinnedSha:
      manifest.source.type === "git-subdir" || manifest.source.type === "git-repo"
        ? manifest.source.sha
        : undefined,
    manifest: {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      license: manifest.license,
      author: manifest.author,
      upstream: manifest.upstream,
      attribution: manifest.attribution,
      permissions: manifest.permissions,
      contributes: manifest.contributes,
      requires: manifest.requires,
    },
  }
  await upsertInstalled(installed)
  // Hot-load: registry'lere ekle
  await loadPlugin(installed)
  return installed
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const store = await readInstalled()
  const p = store.plugins.find((x) => x.id === pluginId)
  if (!p) return
  unloadPlugin(pluginId)
  if (await exists(p.installPath)) {
    await Command.create("bash", [
      "-lc",
      `rm -rf ${shellQuote(p.installPath)}`,
    ]).execute()
  }
  await removeInstalled(pluginId)
}

export async function togglePluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const store = await readInstalled()
  const p = store.plugins.find((x) => x.id === pluginId)
  if (!p) return
  p.enabled = enabled
  await upsertInstalled(p)
  if (enabled) {
    await loadPlugin(p)
  } else {
    unloadPlugin(pluginId)
  }
}

// Plugin LICENSE/NOTICE/README okuma — UI detay modal'ı için.
export async function readPluginFile(
  pluginId: string,
  filename: "LICENSE" | "NOTICE" | "README.md" | "ATTRIBUTION.txt",
): Promise<string | null> {
  const store = await readInstalled()
  const p = store.plugins.find((x) => x.id === pluginId)
  if (!p) return null
  const path = p.installPath + "/" + filename
  if (!(await exists(path))) return null
  try {
    return await readTextFile(path)
  } catch {
    return null
  }
}
