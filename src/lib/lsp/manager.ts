// LSP manager — lazy, pooled language-server lifecycle + high-level queries.
//
// One server process per (serverID, workspaceRoot). Started on first query for a
// matching file, reused after. Files are opened (didOpen) once, then kept in sync.
// All positions here are 0-based LSP coordinates; 1-based callers convert first.
import { readTextFile, exists } from "@tauri-apps/plugin-fs"
import { sanitizeSurrogates } from "@/lib/providers/transform"
import { startClient, type LspClient, type LspDiagnostic } from "./client"
import { serverForPath, type LspServer } from "./servers"
import { uriMatchesPath } from "./uri"
import { resolveBundled, resolveInstalled, installServer } from "./download"
import { toast } from "@/store/toast"

type Entry = { client: LspClient; openFiles: Set<string>; lastUsed: number }

// key = `${serverID}:${workspaceRoot}` → entry promise (promise = in-flight dedup).
const pool = new Map<string, Promise<Entry>>()

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const REAP_INTERVAL_MS = 60 * 1000 // 1 dk'da bir tara
let reaper: ReturnType<typeof setInterval> | null = null

function ensureReaper(): void {
  if (reaper) return
  reaper = setInterval(() => void reapIdle(), REAP_INTERVAL_MS)
}

async function reapIdle(): Promise<void> {
  const now = Date.now()
  for (const [key, p] of [...pool]) {
    try {
      const entry = await p
      if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
        pool.delete(key)
        await entry.client.stop()
      }
    } catch {
      pool.delete(key)
    }
  }
  if (pool.size === 0 && reaper) {
    clearInterval(reaper)
    reaper = null
  }
}

const LSP_INSTALLING = "LSP_INSTALLING"

const installState = new Map<string, "installing" | "ready" | "failed">()

function startBackgroundInstall(server: LspServer): void {
  if (installState.get(server.id) === "installing") return
  installState.set(server.id, "installing")
  toast.info(`${server.id} dil sunucusu indiriliyor…`)
  installServer(server)
    .then(() => {
      installState.set(server.id, "ready")
      toast.success(`${server.id} dil sunucusu hazır`)
    })
    .catch((e) => {
      installState.set(server.id, "failed")
      toast.error(`${server.id} indirilemedi: ${String(e)}`)
    })
}

async function projectTsserverPath(workspaceRoot: string): Promise<string | null> {
  const candidates = [
    `${workspaceRoot}/node_modules/typescript/lib/tsserver.js`,
    `${workspaceRoot}/node_modules/typescript/lib/tsserverlibrary.js`,
  ]
  for (const c of candidates) {
    try {
      if (await exists(c)) return c
    } catch {
      // Intentionally ignored.
    }
  }
  return null
}

async function initOptionsFor(server: LspServer, workspaceRoot: string): Promise<unknown | null> {
  if (server.id === "typescript") {
    const p = await projectTsserverPath(workspaceRoot)
    return {
      hostInfo: "codezal",
      tsserver: {
        ...(p ? { path: p } : {}),
        // diagnostics, cross-file references). VS Code'un default'u "auto" ama bizim
        useSyntaxServer: "never",
        logVerbosity: import.meta.env.DEV ? "verbose" : "off",
      },
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
        allowIncompleteCompletions: true,
        includePackageJsonAutoImports: "auto",
      },
    }
  }
  return null
}

// Returns the pooled entry for a file, starting the server if needed.
// - null: no server configured for this extension
// - throws LSP_INSTALLING: server is downloading in the background (non-blocking)
// - throws otherwise: failed to start
async function ensureClient(workspaceRoot: string, filePath: string): Promise<Entry | null> {
  const server = serverForPath(filePath)
  if (!server) return null

  const key = `${server.id}:${workspaceRoot}`
  const existing = pool.get(key)
  if (existing) {
    try {
      return await existing
    } catch (e) {
      pool.delete(key)
      throw e
    }
  }

  let cmd: string
  let args = server.args
  const bundled = await resolveBundled(server)
  if (bundled) {
    cmd = bundled.cmd
    args = bundled.args
  } else {
    const installed = await resolveInstalled(server)
    if (!installed) {
      if (server.download) {
        startBackgroundInstall(server)
        throw new Error(LSP_INSTALLING)
      }
      throw new Error(`${server.id}: kurulu değil ve otomatik indirilemiyor`)
    }
    cmd = installed
    installState.delete(server.id)
  }

  const initOpts = await initOptionsFor(server, workspaceRoot)
  const finalArgs =
    import.meta.env.DEV &&
    server.id === "typescript" &&
    !args.some((a) => a.startsWith("--log-level"))
      ? [...args, "--log-level=4"]
      : args

  const pending = (async () => {
    const client = await startClient(key, workspaceRoot, server, cmd, finalArgs, initOpts)
    return { client, openFiles: new Set<string>(), lastUsed: Date.now() }
  })()
  pool.set(key, pending)
  ensureReaper()
  try {
    return await pending
  } catch (e) {
    pool.delete(key)
    throw e
  }
}

// didOpen on first touch, didChange (with fresh content) on later touches.
// Returns true when this was the first open (caller may wait for push diagnostics).
async function ensureOpen(entry: Entry, filePath: string): Promise<boolean> {
  const content = sanitizeSurrogates(await readTextFile(filePath))
  if (entry.openFiles.has(filePath)) {
    await entry.client.changeFile(filePath, content)
    return false
  }
  await entry.client.openFile(filePath, content)
  entry.openFiles.add(filePath)
  return true
}

export type LspUnavailable = { available: false; reason: string }
export type LspResult<T> = { available: true; data: T }
export type LspQuery<T> = LspResult<T> | LspUnavailable

// Wrap ensureClient + ensureOpen + a query into a uniform availability result.
async function withClient<T>(
  workspaceRoot: string,
  filePath: string,
  fn: (entry: Entry, firstOpen: boolean) => Promise<T>,
): Promise<LspQuery<T>> {
  let entry: Entry | null
  try {
    entry = await ensureClient(workspaceRoot, filePath)
  } catch (e) {
    const msg = String(e)
    if (msg.includes(LSP_INSTALLING)) {
      return { available: false, reason: "dil sunucusu indiriliyor — birazdan tekrar dene" }
    }
    return { available: false, reason: `language server failed to start: ${msg}` }
  }
  if (!entry) return { available: false, reason: "no language server configured for this file" }
  entry.lastUsed = Date.now()

  try {
    const firstOpen = await ensureOpen(entry, filePath)
    const data = await fn(entry, firstOpen)
    return { available: true, data }
  } catch (e) {
    return { available: false, reason: String(e) }
  }
}

export function lspHover(workspaceRoot: string, filePath: string, line: number, character: number) {
  return withClient(workspaceRoot, filePath, (e) => e.client.hover(filePath, line, character))
}

export function lspDefinition(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, (e) => e.client.definition(filePath, line, character))
}

export function lspReferences(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, (e) => e.client.references(filePath, line, character))
}

export function lspImplementation(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, (e) =>
    e.client.implementation(filePath, line, character),
  )
}

export function lspDocumentSymbol(workspaceRoot: string, filePath: string) {
  return withClient(workspaceRoot, filePath, (e) => e.client.documentSymbol(filePath))
}

export function lspWorkspaceSymbol(workspaceRoot: string, anchorPath: string, query: string) {
  return withClient(workspaceRoot, anchorPath, (e) => e.client.workspaceSymbol(query))
}

export function lspPrepareCallHierarchy(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, (e) =>
    e.client.prepareCallHierarchy(filePath, line, character),
  )
}

export function lspIncomingCalls(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, async (e) => {
    const items = (await e.client.prepareCallHierarchy(filePath, line, character)) as unknown[]
    if (!Array.isArray(items) || items.length === 0) return []
    return e.client.incomingCalls(items[0])
  })
}

export function lspOutgoingCalls(
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number,
) {
  return withClient(workspaceRoot, filePath, async (e) => {
    const items = (await e.client.prepareCallHierarchy(filePath, line, character)) as unknown[]
    if (!Array.isArray(items) || items.length === 0) return []
    return e.client.outgoingCalls(items[0])
  })
}

// Diagnostics are pushed asynchronously after didOpen — wait briefly on first
// open so the first call doesn't return an empty list before the server reports.
export function lspDiagnostics(
  workspaceRoot: string,
  filePath: string,
  waitMs = 1500,
): Promise<LspQuery<LspDiagnostic[]>> {
  return withClient(workspaceRoot, filePath, async (e, firstOpen) => {
    if (firstOpen && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
    return e.client.getDiagnostics(filePath)
  })
}

export type LspEditHandle = {
  change: (content: string) => Promise<void>
  onDiagnostics: (cb: (diags: LspDiagnostic[]) => void) => Promise<() => void>
  codeAction: (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    diagnostics: unknown[],
  ) => Promise<unknown>
  resolveCodeAction: (action: unknown) => Promise<unknown>
  executeCommand: (command: string, args: unknown[]) => Promise<unknown>
  dispose: () => Promise<void>
}

export async function lspEditSession(
  workspaceRoot: string,
  filePath: string,
  initialContent: string,
): Promise<LspQuery<LspEditHandle>> {
  let entry: Entry | null
  try {
    entry = await ensureClient(workspaceRoot, filePath)
  } catch (e) {
    const msg = String(e)
    if (msg.includes(LSP_INSTALLING)) {
      return { available: false, reason: "dil sunucusu indiriliyor — birazdan tekrar dene" }
    }
    return { available: false, reason: `language server failed to start: ${msg}` }
  }
  if (!entry) return { available: false, reason: "no language server configured for this file" }
  const e = entry
  e.lastUsed = Date.now()

  try {
    if (e.openFiles.has(filePath)) {
      await e.client.changeFile(filePath, initialContent)
    } else {
      await e.client.openFile(filePath, initialContent)
      e.openFiles.add(filePath)
    }
  } catch (err) {
    return { available: false, reason: String(err) }
  }

  const unlisteners: Array<() => void> = []
  const handle: LspEditHandle = {
    change: async (content) => {
      e.lastUsed = Date.now()
      try {
        await e.client.changeFile(filePath, content)
      } catch {
        // Intentionally ignored.
      }
    },
    onDiagnostics: async (cb) => {
      const un = await e.client.onDiagnostics((ev) => {
        if (uriMatchesPath(ev.uri, filePath)) cb(ev.diagnostics)
      })
      unlisteners.push(un)
      return un
    },
    codeAction: (startLine, startCharacter, endLine, endCharacter, diagnostics) => {
      e.lastUsed = Date.now()
      return e.client.codeAction(
        filePath,
        startLine,
        startCharacter,
        endLine,
        endCharacter,
        diagnostics,
      )
    },
    resolveCodeAction: (action) => {
      e.lastUsed = Date.now()
      return e.client.resolveCodeAction(action)
    },
    executeCommand: (command, args) => {
      e.lastUsed = Date.now()
      return e.client.executeCommand(command, args)
    },
    dispose: async () => {
      for (const un of unlisteners.splice(0)) {
        try {
          un()
        } catch {
          // ignore
        }
      }
      try {
        const disk = await readTextFile(filePath)
        await e.client.changeFile(filePath, disk)
      } catch {
        // Intentionally ignored.
      }
    },
  }
  return { available: true, data: handle }
}

// Stop every running server (workspace switch / app shutdown).
export async function shutdownAllLsp(): Promise<void> {
  if (reaper) {
    clearInterval(reaper)
    reaper = null
  }
  const entries = [...pool.values()]
  pool.clear()
  await Promise.allSettled(
    entries.map(async (p) => {
      try {
        const entry = await p
        await entry.client.stop()
      } catch {
        // Never started cleanly — nothing to stop.
      }
    }),
  )
}
