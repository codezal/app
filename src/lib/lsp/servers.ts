// LSP server registry — extension → server, plus delivery info.
//
// Delivery is one of:
//   bundled  → shipped inside the app (run via bundled Bun). Set `bundled`.
//   download → fetched from a GitHub release on first use. Set `download`.
//   (neither) → PATH-only: used if already installed, else "unavailable".

// Auto-download config (native binaries from GitHub releases).
// os: "macos"|"linux"|"windows", arch: "aarch64"|"x86_64" (from lsp_platform).
export type ServerDownload = {
  /** GitHub "owner/repo" whose latest release holds the binary. */
  repo: string
  /** Pick the right asset from a release's asset names (handles versioned names, .minisig noise). */
  pickAsset: (names: string[], os: string, arch: string) => string | null
  /** Path of the binary inside the archive (zip/tar). Omit for single-file gzip/raw. */
  binInArchive?: (assetName: string, os: string) => string
}

// Bundled server run via the app's Bun runtime: `bun <entry> <args>`.
export type ServerBundled = {
  /** JS entrypoint relative to the bundled lsp resource dir (resources/lsp/). */
  entry: string
}

export type LspServer = {
  /** Stable id, also used as part of the Rust session key. */
  id: string
  /** Executable name resolved from PATH (download/PATH delivery). */
  command: string
  /** Args that put the server in stdio JSON-RPC mode. */
  args: string[]
  /** File extensions (without dot) this server handles. */
  extensions: string[]
  /** Auto-download from GitHub release when not on PATH. */
  download?: ServerDownload
  /** Shipped inside the app, run via bundled Bun. Takes priority over download/PATH. */
  bundled?: ServerBundled
}

// GNU/Rust target triple segment per OS.
const TRIPLE: Record<string, string> = {
  macos: "apple-darwin",
  linux: "unknown-linux-gnu",
  windows: "pc-windows-msvc",
}

// Archive format inferred from an asset's filename.
export function archiveFormat(assetName: string): "gzip" | "zip" | "tar.xz" | "tar.gz" | "raw" {
  if (assetName.endsWith(".tar.xz")) return "tar.xz"
  if (assetName.endsWith(".tar.gz")) return "tar.gz"
  if (assetName.endsWith(".zip")) return "zip"
  if (assetName.endsWith(".gz")) return "gzip"
  return "raw"
}

// Ordered by specificity — first match wins for a given extension.
export const SERVERS: LspServer[] = [
  // ══ BUNDLED (shipped in-app, run via Bun) — most-used languages, zero install ══
  {
    id: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
    bundled: { entry: "node_modules/typescript-language-server/lib/cli.mjs" },
  },
  {
    id: "pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: ["py", "pyi"],
    bundled: { entry: "node_modules/pyright/langserver.index.js" },
  },
  {
    id: "php",
    command: "intelephense",
    args: ["--stdio"],
    extensions: ["php"],
    bundled: { entry: "node_modules/intelephense/lib/intelephense.js" },
  },

  // ══ DOWNLOAD (lazy from GitHub release) — native binaries ══
  {
    id: "rust",
    command: "rust-analyzer",
    args: [],
    extensions: ["rs"],
    download: {
      repo: "rust-lang/rust-analyzer",
      // rust-analyzer-<arch>-<triple>.<gz|zip>
      pickAsset: (names, os, arch) => {
        const triple = TRIPLE[os]
        if (!triple) return null
        const want = `rust-analyzer-${arch}-${triple}.${os === "windows" ? "zip" : "gz"}`
        return names.includes(want) ? want : null
      },
      binInArchive: () => "rust-analyzer.exe", // only used for windows zip
    },
  },
  {
    id: "clangd",
    command: "clangd",
    args: [],
    extensions: ["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "c++", "objc"],
    download: {
      repo: "clangd/clangd",
      // clangd-<mac|linux|windows>-<version>.zip  (skip indexing_tools / debug-symbols)
      pickAsset: (names, os) => {
        const plat = ({ macos: "mac", linux: "linux", windows: "windows" } as Record<string, string>)[
          os
        ]
        if (!plat) return null
        return names.find((n) => new RegExp(`^clangd-${plat}-[0-9.]+\\.zip$`).test(n)) ?? null
      },
      binInArchive: (assetName, os) => {
        const ver = assetName.match(/[0-9.]+(?=\.zip$)/)?.[0] ?? ""
        return `clangd_${ver}/bin/clangd${os === "windows" ? ".exe" : ""}`
      },
    },
  },
  {
    id: "zig",
    command: "zls",
    args: [],
    extensions: ["zig", "zon"],
    download: {
      repo: "zigtools/zls",
      // zls-<arch>-<macos|linux|windows>.<tar.xz|zip>  (exact name skips .minisig)
      pickAsset: (names, os, arch) => {
        const plat = ({ macos: "macos", linux: "linux", windows: "windows" } as Record<
          string,
          string
        >)[os]
        if (!plat) return null
        const want = `zls-${arch}-${plat}.${os === "windows" ? "zip" : "tar.xz"}`
        return names.includes(want) ? want : null
      },
      binInArchive: (_assetName, os) => `zls${os === "windows" ? ".exe" : ""}`,
    },
  },

  // ══ PATH-only / special runtime (not yet auto-installed) ══
  // gopls: no prebuilt binary — needs `go install` (Go SDK). gopls yazan Go'ya sahip.
  { id: "gopls", command: "gopls", args: [], extensions: ["go"] },
  { id: "java", command: "jdtls", args: [], extensions: ["java"] },
  { id: "lua", command: "lua-language-server", args: [], extensions: ["lua"] },
  { id: "swift", command: "sourcekit-lsp", args: [], extensions: ["swift"] },
  { id: "vue", command: "vue-language-server", args: ["--stdio"], extensions: ["vue"] },
  { id: "svelte", command: "svelteserver", args: ["--stdio"], extensions: ["svelte"] },
  { id: "astro", command: "astro-ls", args: ["--stdio"], extensions: ["astro"] },
  {
    id: "html",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    extensions: ["html", "htm"],
  },
  {
    id: "css",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    extensions: ["css", "scss", "less", "sass"],
  },
  {
    id: "json",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    extensions: ["json", "jsonc"],
  },
  { id: "yaml", command: "yaml-language-server", args: ["--stdio"], extensions: ["yaml", "yml"] },
  { id: "bash", command: "bash-language-server", args: ["start"], extensions: ["sh", "bash", "zsh"] },
  { id: "ruby", command: "ruby-lsp", args: [], extensions: ["rb", "rake", "gemspec"] },
  { id: "elixir", command: "elixir-ls", args: [], extensions: ["ex", "exs"] },
  { id: "kotlin", command: "kotlin-language-server", args: [], extensions: ["kt", "kts"] },
  { id: "csharp", command: "csharp-ls", args: [], extensions: ["cs"] },
]

export function extensionOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase()
}

export function serverForPath(filePath: string): LspServer | undefined {
  const ext = extensionOf(filePath)
  if (!ext) return undefined
  return SERVERS.find((s) => s.extensions.includes(ext))
}
