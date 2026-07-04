#!/usr/bin/env node
// Prepare the bundled LSP resources: Bun runtime + node-based servers.
//
// Output (git-ignored, regenerated before build):
//   src-tauri/resources/lsp/bin/bun                      ← Bun runtime (platform binary)
//   src-tauri/resources/lsp/node_modules/
//       typescript-language-server/   (TS + JS)
//       pyright/                      (Python)
//       intelephense/                 (PHP)
//
// Servers are pure JS → platform-agnostic. Only Bun is platform-specific;
// this downloads the binary for the CURRENT os/arch. Release CI runs it per target.
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  chmodSync,
  existsSync,
} from "node:fs"
import { arch, platform } from "node:os"

const LSP_DIR = "src-tauri/resources/lsp"
const SERVERS = ["typescript-language-server", "pyright", "intelephense"]

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts })
}

// ── 1. Node-based servers (pure JS, platform-agnostic) ──
mkdirSync(LSP_DIR, { recursive: true })
console.log("→ LSP server'ları kuruluyor (npm)…")
run("npm", ["install", "--prefix", LSP_DIR, "--no-save", "--no-package-lock", ...SERVERS], {
  shell: process.platform === "win32",
})

// ── 2. Bun runtime (platform-specific binary) ──
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || ""
const a = triple
  ? triple.startsWith("aarch64")
    ? "aarch64"
    : "x64"
  : arch() === "arm64"
    ? "aarch64"
    : "x64"
const p = triple
  ? triple.includes("windows")
    ? "windows"
    : triple.includes("darwin")
      ? "darwin"
      : "linux"
  : platform() === "darwin"
    ? "darwin"
    : platform() === "win32"
      ? "windows"
      : "linux"
const BUN_VERSION = "bun-v1.3.14"
const assetBase = `bun-${p}-${a}`
const ext = p === "windows" ? ".exe" : ""
const binDir = `${LSP_DIR}/bin`
const bunBin = `${binDir}/bun${ext}`
const marker = `${binDir}/.bun-target`
const markerValue = `${assetBase}-${BUN_VERSION}`

const upToDate =
  existsSync(bunBin) && existsSync(marker) && readFileSync(marker, "utf8").trim() === markerValue

if (upToDate) {
  console.log(`→ Bun zaten ${assetBase}, atlanıyor`)
} else {
  console.log(`→ Bun indiriliyor (${assetBase} ${BUN_VERSION})…`)
  const url = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${assetBase}.zip`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Bun indirilemedi: HTTP ${res.status} — ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1_000_000)
    throw new Error(`Bun indirmesi çok küçük (${buf.length} B) — bozuk zip / yanlış URL?`)
  const zipPath = `${LSP_DIR}/bun.zip`
  writeFileSync(zipPath, buf)
  mkdirSync(binDir, { recursive: true })
  if (p === "windows") {
    run("powershell", ["-Command", `Expand-Archive -Force '${zipPath}' '${LSP_DIR}'`])
  } else {
    run("unzip", ["-o", zipPath, "-d", LSP_DIR])
  }
  // bun-<platform>-<arch>/bun → bin/bun
  renameSync(`${LSP_DIR}/${assetBase}/bun${ext}`, bunBin)
  chmodSync(bunBin, 0o755)
  writeFileSync(marker, markerValue)
  rmSync(zipPath)
  rmSync(`${LSP_DIR}/${assetBase}`, { recursive: true, force: true })
}

console.log("✓ LSP bundle hazır:", LSP_DIR)
