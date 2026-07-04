// Variable substitution for config values.
//
// Two token forms, mirroring opencode's config/variable.ts:
//   {env:VAR_NAME}   → value of an environment variable
//   {file:path}      → trimmed contents of a file (~/ and relative paths ok)
//
// Used in two places:
//   1. Project config text (`.codezal/config.json`) — full-text substitution
//      before JSON parsing, so any value can reference env/files.
//   2. Secret resolution at auth-build time (resolveSecret) — so API keys can
//      live as `{env:OPENAI_API_KEY}` or `{file:~/.secrets/openai}` in the
//      GUI settings instead of plaintext. The persisted value keeps the token;
//      resolution is in-memory only and never written back.

import { readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { readEnvVar } from "@/lib/providers/env-reader"

const ENV_TOKEN = /\{env:([^}]+)\}/g
const FILE_TOKEN = /\{file:([^}]+)\}/g
// A value is "pure token" when it is exactly one {env:..}/{file:..} and nothing
// else — the common case for an API key field.
const PURE_ENV = /^\{env:([^}]+)\}$/
const PURE_FILE = /^\{file:([^}]+)\}$/
// Shell-native env var syntax: ${VAR_NAME} veya $VAR_NAME (harf/rakam/_).
const SHELL_VAR_TOKEN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

// Resolve a {file:} path: expand `~/`, and resolve a relative path against the
// config directory when one is provided (so `{file:./key}` in
// `.codezal/config.json` reads `.codezal/key`, not a cwd-relative path).
// Without `dir`, a relative path is returned as-is (back-compat for resolveSecret,
// where API-key fields use absolute or ~/ paths).
async function resolveFilePath(raw: string, dir?: string): Promise<string> {
  const trimmed = raw.trim()
  if (trimmed.startsWith("~/")) {
    const home = (await homeDir()).replace(/[\\/]+$/, "")
    return `${home}/${trimmed.slice(2)}`
  }
  const isAbsolute = trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)
  if (!isAbsolute && dir) {
    return `${dir.replace(/[\\/]+$/, "")}/${trimmed}`
  }
  return trimmed
}

// Read an env var: prefer the Tauri (Rust) reader so vars visible only to the
// host process resolve, then fall back to a synchronously-available process.env
// (test/node contexts). Returns null when set nowhere.
async function readEnv(name: string): Promise<string | null> {
  const fromTauri = await readEnvVar(name)
  if (fromTauri != null) return fromTauri
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined
  return fromProcess ?? null
}

// True when the token at `index` sits on a line whose first non-space chars are
// `//` — i.e. a JSONC comment. Such tokens are left verbatim (an example token
// in a comment must not trigger a file read or leak an env value).
function inLineComment(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1
  return text.slice(lineStart, index).trimStart().startsWith("//")
}

// Resolve a single config value that MAY be a substitution token.
// Returns the original string unchanged when it contains no token.
// Failures (missing env/file) resolve to an empty string so a bad reference
// degrades to "not configured" rather than throwing inside the auth chain.
export async function resolveSecret(value: string | undefined): Promise<string | undefined> {
  if (!value) return value

  const envMatch = value.match(PURE_ENV)
  if (envMatch) {
    const v = await readEnv(envMatch[1].trim())
    return v?.trim() ?? ""
  }

  const fileMatch = value.match(PURE_FILE)
  if (fileMatch) {
    try {
      const path = await resolveFilePath(fileMatch[1])
      return (await readTextFile(path)).trim()
    } catch {
      return ""
    }
  }

  return value
}

// Full-text substitution over arbitrary config source text. Applied before the
// JSONC parse step so structural and string values alike can embed tokens.
// `missing: "empty"` (default) swaps unresolved tokens for "" rather than
// failing the whole config load; `missing: "keep"` leaves them verbatim.
// `dir` resolves relative {file:} paths (see resolveFilePath).
// Untrusted (project) scope guard for {file:} paths — mirrors config/merge.ts
// isProjectSafeInstruction: reject home-relative (~), absolute, UNC and any
// `..` escape so a workspace config can only read files inside the project.
function isUntrustedSafeFilePath(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (t.startsWith("~")) return false
  if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(t)) return false
  return !t.replace(/\\/g, "/").split("/").some((s) => s === "..")
}

export async function substituteText(
  text: string,
  // `untrusted`: project (workspace) config — block {env:} and restrict {file:}
  // to safe workspace-relative paths (no host env read / arbitrary file read).
  opts: { missing?: "empty" | "keep"; dir?: string; untrusted?: boolean } = {},
): Promise<string> {
  const missing = opts.missing ?? "empty"

  // {env:..} — async (Tauri IPC may be involved), so collect matches, resolve in
  // parallel, then splice. Tokens inside `//` comments are left untouched.
  const envMatches = Array.from(text.matchAll(ENV_TOKEN))
  if (envMatches.length) {
    const resolved = await Promise.all(
      envMatches.map(async (m) => {
        if (inLineComment(text, m.index)) return m[0]
        // Untrusted project config must not read host environment variables.
        if (opts.untrusted) return missing === "keep" ? m[0] : ""
        const v = await readEnv(m[1].trim())
        if (v != null) return v
        return missing === "keep" ? m[0] : ""
      }),
    )
    text = spliceMatches(text, envMatches, resolved)
  }

  // {file:..} — async file reads. JSON-escape contents so multi-line/quoted text
  // stays valid inside a JSON string literal. Comment tokens left untouched.
  const fileMatches = Array.from(text.matchAll(FILE_TOKEN))
  if (fileMatches.length) {
    const resolved = await Promise.all(
      fileMatches.map(async (m) => {
        if (inLineComment(text, m.index)) return m[0]
        // Untrusted project config: only workspace-relative, non-escaping paths.
        if (opts.untrusted && !isUntrustedSafeFilePath(m[1])) {
          return missing === "keep" ? m[0] : ""
        }
        try {
          const path = await resolveFilePath(m[1], opts.dir)
          const content = (await readTextFile(path)).trim()
          return JSON.stringify(content).slice(1, -1)
        } catch {
          return missing === "keep" ? m[0] : ""
        }
      }),
    )
    text = spliceMatches(text, fileMatches, resolved)
  }

  return text
}

export async function expandShellVars(value: string): Promise<string> {
  if (!value) return value
  // ~ veya ~/ → home dir
  let result = value
  if (result === "~" || result.startsWith("~/") || result.startsWith("~\\")) {
    const home = (await homeDir()).replace(/[\\/]+$/, "")
    result = home + result.slice(1)
  }
  // $VAR / ${VAR} — async IPC, collect + splice
  const matches = Array.from(result.matchAll(SHELL_VAR_TOKEN))
  if (!matches.length) return result
  const resolved = await Promise.all(
    matches.map(async (m) => {
      const name = (m[1] ?? m[2]).trim()
      const v = await readEnv(name)
      return v ?? m[0]
    }),
  )
  return spliceMatches(result, matches, resolved)
}

// Replace each regex match with its resolved value using match indices, so a
// resolved value that itself looks like a token is never re-scanned.
function spliceMatches(text: string, matches: RegExpMatchArray[], replacements: string[]): string {
  let out = ""
  let cursor = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const index = m.index ?? 0
    out += text.slice(cursor, index) + replacements[i]
    cursor = index + m[0].length
  }
  out += text.slice(cursor)
  return out
}
