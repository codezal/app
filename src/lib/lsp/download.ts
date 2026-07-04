// LSP server delivery — resolve a server's runnable command across three paths:
//   bundled  → app's Bun runs the shipped entry (resolveBundled)
//   PATH/cache → verified PATH command or prior download (resolveInstalled)
//   download → fetch from GitHub release on first use (installServer)
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { archiveFormat, type LspServer } from "./servers"

type Platform = { os: string; arch: string }

let cachedPlatform: Platform | null = null
async function getPlatform(): Promise<Platform> {
  if (!cachedPlatform) cachedPlatform = await invoke<Platform>("lsp_platform")
  return cachedPlatform
}

export type InstallProgress = { downloaded: number; total: number }
export type ResolvedCommand = { cmd: string; args: string[] }

// Run a bundled server via the app's Bun runtime. Returns null when the bundle
// isn't present (e.g. dev builds) so callers fall back to PATH/download.
export async function resolveBundled(server: LspServer): Promise<ResolvedCommand | null> {
  if (!server.bundled) return null
  const dir = await invoke<string | null>("lsp_resource_dir")
  if (!dir) return null
  const { os } = await getPlatform()
  const bun = `${dir}/bin/bun${os === "windows" ? ".exe" : ""}`
  const entry = `${dir}/${server.bundled.entry}`
  if (!(await invoke<boolean>("lsp_path_exists", { path: entry }))) return null
  return { cmd: bun, args: [entry, ...server.args] }
}

// Download + extract a server's binary from its GitHub release.
// Returns the installed absolute path.
export async function installServer(
  server: LspServer,
  onProgress?: (p: InstallProgress) => void,
): Promise<string> {
  if (!server.download) throw new Error(`${server.id}: lazy-download desteklenmiyor`)
  const { os, arch } = await getPlatform()

  const res = await fetch(`https://api.github.com/repos/${server.download.repo}/releases/latest`)
  if (!res.ok) throw new Error(`GitHub release alınamadı (${res.status})`)
  const data = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] }
  const assets = data.assets ?? []

  const assetName = server.download.pickAsset(
    assets.map((a) => a.name),
    os,
    arch,
  )
  if (!assetName) throw new Error(`${server.id}: ${os}/${arch} için release yok`)
  const url = assets.find((a) => a.name === assetName)?.browser_download_url
  if (!url) throw new Error(`${server.id}: asset URL bulunamadı (${assetName})`)

  let unlisten: (() => void) | undefined
  if (onProgress) {
    unlisten = await listen<InstallProgress>(`lsp:install:${server.id}`, (e) => onProgress(e.payload))
  }
  try {
    return await invoke<string>("lsp_install_server", {
      id: server.id,
      url,
      format: archiveFormat(assetName),
      binName: server.download.binInArchive?.(assetName, os) ?? "",
    })
  } finally {
    unlisten?.()
  }
}

// Already-available command (no download). PATH (verified) or cache, else null.
export async function resolveInstalled(server: LspServer): Promise<string | null> {
  // 1. On PATH and actually runnable? (verified — defeats the rustup shim trap)
  if (await invoke<boolean>("lsp_check_command", { cmd: server.command })) {
    return server.command
  }
  // 2. Already downloaded to cache?
  return invoke<string | null>("lsp_server_installed", { id: server.id })
}
