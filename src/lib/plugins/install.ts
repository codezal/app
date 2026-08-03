import { runProgram, copyDir, removeDir, type RunProgramOpts } from "@/lib/exec"
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  remove,
} from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { getVersion } from "@tauri-apps/api/app"
import {
  parsePluginManifest,
  satisfiesMinVersion,
} from "./manifest"
import {
  upsertInstalled,
  removeInstalled,
  readInstalled,
} from "./installed"
import { loadPlugin, unloadPlugin } from "./loader"
import { appendAudit } from "./audit"
import { computeDirFingerprint } from "./fingerprint"
import { enforceCuratedSignature } from "./signing"
import { withLock } from "../lock"
import type {
  InstalledPlugin,
  MarketplacePluginManifest,
  PluginSource,
} from "./types"

async function pluginsRoot(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal/plugins"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

async function runGit(
  args: string[],
  label: string,
  opts: RunProgramOpts = {},
): Promise<string> {
  const r = await runProgram("git", args, opts)
  if (r.code !== 0) {
    throw new Error(
      `${label} başarısız (code ${r.code}): ${r.stderr.trim() || r.stdout.trim() || "no output"}`,
    )
  }
  return r.stdout.trim()
}

// SHA format validation — 40-hex git SHA-1 veya 64-hex SHA-256.
// Manifest'te beklenmedik format = malicious veya bozuk veri.
function assertValidGitSha(sha: string): void {
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`Geçersiz SHA formatı: "${sha}" (40 veya 64 hex bekleniyor)`)
  }
}

// A manifest-supplied RELATIVE path must stay relative and flat — a `..`
// segment (or an absolute/drive path) lets an attacker manifest reach outside
// the cloned repo / marketplace dir (e.g. `~/../.ssh`) and copy it into the
// plugins directory (M15).
function assertSafeRelPath(p: string, label: string): void {
  const segs = p.split(/[\\/]+/)
  if (!p || segs.some((s) => s === "..") || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("\\")) {
    throw new Error(`${label} güvenli değil (path traversal): "${p}"`)
  }
}

// Absolute sources (`local`) must not contain `..` segments either.
function assertNoTraversal(p: string, label: string): void {
  if (p.split(/[\\/]+/).some((s) => s === "..")) {
    throw new Error(`${label} '..' içeremez (path traversal): "${p}"`)
  }
}

async function fetchPluginSource(
  source: PluginSource,
  marketplaceLocalPath: string | undefined,
  destDir: string,
): Promise<void> {
  if (source.type === "git-subdir" || source.type === "git-repo") {
    assertValidGitSha(source.sha)
    if (source.type === "git-subdir") assertSafeRelPath(source.path, "git-subdir source.path")
    const tmpDir = destDir + ".tmp"
    await removeDir(tmpDir)
    const repoUrl = source.repo.startsWith("http") || source.repo.startsWith("git@")
      ? source.repo
      : `https://github.com/${source.repo}.git`
    await runGit(
      ["clone", "--filter=blob:none", "--no-checkout", repoUrl, tmpDir],
      "git clone",
      { timeoutMs: 180_000 },
    )
    await runGit(
      ["checkout", source.sha],
      `SHA checkout (${source.sha.slice(0, 8)})`,
      { cwd: tmpDir },
    )
    const headSha = await runGit(["rev-parse", "HEAD"], "HEAD SHA okuma", { cwd: tmpDir })
    if (headSha !== source.sha) {
      await removeDir(tmpDir)
      throw new Error(
        `SHA doğrulama başarısız: beklenen ${source.sha}, alınan ${headSha}. Marketplace manifest ile upstream HEAD eşleşmiyor.`,
      )
    }
    console.info(`[plugin install] SHA verified: ${source.sha.slice(0, 8)}`)
    const srcPath = source.type === "git-subdir" ? `${tmpDir}/${source.path}` : tmpDir
    if (!(await exists(srcPath))) {
      throw new Error(`Source path bulunamadı: ${srcPath}`)
    }
    await copyDir(srcPath, destDir)
    await removeDir(tmpDir)
    return
  }
  if (source.type === "inline") {
    if (!marketplaceLocalPath) {
      throw new Error("Inline source için marketplace localPath gerekli")
    }
    assertSafeRelPath(source.path, "inline source.path")
    const srcPath = marketplaceLocalPath + "/" + source.path
    if (!(await exists(srcPath))) {
      throw new Error(`Inline source path yok: ${srcPath}`)
    }
    await copyDir(srcPath, destDir)
    return
  }
  if (source.type === "local") {
    assertNoTraversal(source.absolutePath, "local source.absolutePath")
    if (!(await exists(source.absolutePath))) {
      throw new Error(`Local source path yok: ${source.absolutePath}`)
    }
    await copyDir(source.absolutePath, destDir)
    return
  }
  throw new Error(`Bilinmeyen source type`)
}

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
}

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

  const minVersion = manifest.requires?.codezalMinVersion
  if (minVersion) {
    const current = await getVersion()
    if (!satisfiesMinVersion(current, minVersion)) {
      throw new Error(
        `Plugin codezal >= ${minVersion} gerektiriyor; yüklü sürüm ${current}. Kurulum reddedildi.`,
      )
    }
  }

  // Curated channel is the trust boundary — the signature IS the curation.
  // Always verify, regardless of the manifest's self-declared `verified` flag
  // (an attacker who can edit the marketplace can flip that flag). Anything
  // other than a valid signature blocks the install.
  if (manifest.channel === "codezal-curated") {
    try {
      await enforceCuratedSignature(manifest)
      await appendAudit({ ts: Date.now(), event: "signature-verify", plugin: id })
    } catch (e) {
      await appendAudit({
        ts: Date.now(),
        event: "signature-fail",
        plugin: id,
        detail: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  try {
    await withLock(`plugin-install:${installDir}`, async () => {
      if (await exists(installDir)) {
        await removeDir(installDir)
      }

      console.info(`[plugin install] source fetch: ${manifest.source.type}`)
      await fetchPluginSource(manifest.source, marketplaceLocalPath, installDir)

      const diskManifestPath = installDir + "/.codezal-plugin/plugin.json"
      if (!(await exists(diskManifestPath))) {
        await removeDir(installDir)
        throw new Error(".codezal-plugin/plugin.json bulunamadı — plugin formatı uyumsuz")
      }
      try {
        parsePluginManifest(await readTextFile(diskManifestPath))
      } catch (e) {
        await removeDir(installDir)
        throw new Error(`Plugin manifest doğrulama: ${(e as Error).message}`, { cause: e })
      }

      await verifyLicense(installDir, manifest.license)

      if (manifest.attribution?.notice) {
        const noticeExtra = installDir + "/ATTRIBUTION.txt"
        if (!(await exists(noticeExtra))) {
          await writeTextFile(
            noticeExtra,
            `Source: ${manifest.attribution.originalRepo}\nOriginal author: ${manifest.attribution.originalAuthor}\nModified: ${manifest.attribution.modified}\n\n${manifest.attribution.notice}\n`,
          )
        }
      }
    })
  } catch (e) {
    console.error(`[plugin install] ${id} fetch/verify hatası:`, e)
    throw e
  }

  const fingerprint = await computeDirFingerprint(installDir)

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
    fingerprint,
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
    throw new Error(`installed_plugins.json yazılamadı: ${(e as Error).message}`, { cause: e })
  }
  try {
    const r = await loadPlugin(installed)
    if (r.warnings.length > 0) {
      console.warn(`[plugin install] ${id} load uyarıları:`, r.warnings.join("; "))
    }
    console.info(`[plugin install] ${id} hot-load OK`, r.registered)
  } catch (e) {
    console.error(`[plugin install] ${id} loadPlugin hatası:`, e)
    installed.enabled = false
    await upsertInstalled(installed)
    throw new Error(`Plugin yüklenemedi (devre dışı bırakıldı): ${(e as Error).message}`, { cause: e })
  }
  await appendAudit({
    ts: Date.now(),
    event: "install",
    plugin: id,
    sha: installed.pinnedSha,
    permissions: manifest.permissions,
    marketplace: marketplaceId,
  })
  return installed
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const store = await readInstalled()
  const p = store.plugins.find((x) => x.id === pluginId)
  if (!p) return
  unloadPlugin(pluginId)
  if (await exists(p.installPath)) {
    await remove(p.installPath, { recursive: true }).catch(() => {})
  }
  await removeInstalled(pluginId)
  await appendAudit({ ts: Date.now(), event: "uninstall", plugin: pluginId })
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
  await appendAudit({
    ts: Date.now(),
    event: enabled ? "enable" : "disable",
    plugin: pluginId,
  })
}

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
