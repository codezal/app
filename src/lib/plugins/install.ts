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

// Cross-platform timeout wrapper (macOS'ta `timeout` yok, Homebrew'de `gtimeout`).
function withTimeout(cmd: string, secs: number): string {
  return `T="$(command -v timeout || command -v gtimeout || true)"; \${T:+$T ${secs} }${cmd}`
}

async function pluginsRoot(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal/plugins"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

// Helper: bash komutunu çalıştır, exit code !== 0 ise mesajla throw.
async function runBash(cmd: string, label: string): Promise<void> {
  const r = await Command.create("bash", ["-lc", cmd]).execute()
  if (r.code !== 0) {
    throw new Error(
      `${label} başarısız (code ${r.code}): ${r.stderr.trim() || r.stdout.trim() || "no output"}`,
    )
  }
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
    await runBash(`rm -rf ${shellQuote(tmpDir)}`, "tmp temizlik")
    const repoUrl = source.repo.startsWith("http") || source.repo.startsWith("git@")
      ? source.repo
      : `https://github.com/${source.repo}.git`
    const cloneCmd = `git clone --filter=blob:none --no-checkout ${shellQuote(repoUrl)} ${shellQuote(tmpDir)}`
    await runBash(withTimeout(cloneCmd, 180), "git clone")
    const checkoutCmd = `cd ${shellQuote(tmpDir)} && git checkout ${shellQuote(source.sha)}`
    await runBash(checkoutCmd, `SHA checkout (${source.sha.slice(0, 8)})`)
    // Subdir'i destDir'e kopyala (veya tüm repo'yu)
    const srcPath = source.type === "git-subdir" ? `${tmpDir}/${source.path}` : tmpDir
    if (!(await exists(srcPath))) {
      throw new Error(`Source path bulunamadı: ${srcPath}`)
    }
    await runBash(
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(srcPath)}/. ${shellQuote(destDir)}/`,
      "kopyalama",
    )
    await runBash(`rm -rf ${shellQuote(tmpDir)}`, "tmp temizlik (post)")
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
    await runBash(
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(srcPath)}/. ${shellQuote(destDir)}/`,
      "inline kopyalama",
    )
    return
  }
  if (source.type === "local") {
    if (!(await exists(source.absolutePath))) {
      throw new Error(`Local source path yok: ${source.absolutePath}`)
    }
    await runBash(
      `mkdir -p ${shellQuote(destDir)} && cp -R ${shellQuote(source.absolutePath)}/. ${shellQuote(destDir)}/`,
      "local kopyalama",
    )
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
  console.info(`[plugin install] ${id} → ${installDir}`)

  try {
    // Mevcutsa önce kaldır (update için)
    if (await exists(installDir)) {
      await runBash(`rm -rf ${shellQuote(installDir)}`, "eski install temizlik")
    }

    console.info(`[plugin install] source fetch: ${manifest.source.type}`)
    await fetchPluginSource(manifest.source, marketplaceLocalPath, installDir)

    // Disk'teki plugin.json'u oku ve manifest ile karşılaştır — temel sanity check
    const diskManifestPath = installDir + "/.codezal-plugin/plugin.json"
    if (!(await exists(diskManifestPath))) {
      await runBash(`rm -rf ${shellQuote(installDir)}`, "rollback (manifest yok)")
      throw new Error(".codezal-plugin/plugin.json bulunamadı — plugin formatı uyumsuz")
    }
    try {
      parsePluginManifest(await readTextFile(diskManifestPath))
    } catch (e) {
      await runBash(`rm -rf ${shellQuote(installDir)}`, "rollback (manifest bozuk)")
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
  } catch (e) {
    console.error(`[plugin install] ${id} fetch/verify hatası:`, e)
    throw e
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
  try {
    await upsertInstalled(installed)
    console.info(`[plugin install] ${id} installed_plugins.json yazıldı`)
  } catch (e) {
    console.error(`[plugin install] ${id} upsertInstalled hatası:`, e)
    throw new Error(`installed_plugins.json yazılamadı: ${(e as Error).message}`)
  }
  try {
    // Hot-load: registry'lere ekle
    const r = await loadPlugin(installed)
    if (r.warnings.length > 0) {
      console.warn(`[plugin install] ${id} load uyarıları:`, r.warnings.join("; "))
    }
    console.info(`[plugin install] ${id} hot-load OK`, r.registered)
  } catch (e) {
    console.error(`[plugin install] ${id} loadPlugin hatası:`, e)
    // Plugin disk + json yazıldı; load hatası fatal sayma — disable et
    installed.enabled = false
    await upsertInstalled(installed)
    throw new Error(`Plugin yüklenemedi (devre dışı bırakıldı): ${(e as Error).message}`)
  }
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
