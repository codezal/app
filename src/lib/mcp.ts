// MCP HTTP/SSE/stdio client — reads server defs from settings.mcpServers,
// lists tools, produces an AI SDK ToolSet. Supports OAuth (PKCE + dynamic client
// registration + refresh), per-server timeouts, parallel connect, live
// tools/list_changed refresh, and best-effort prompts/resources.
// Stdio: Tauri plugin-shell bash -lc + Command.spawn via custom transport.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { withTimeout } from "@/lib/async/timeout"
import { pooledMap } from "@/lib/async/queue"
import { errorMessage } from "@/lib/errors"
import {
  ListToolsResultSchema,
  ToolListChangedNotificationSchema,
  ToolSchema,
  type Tool as McpToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { jsonSchema, tool, type ToolSet } from "ai"
import { start as startLoopback, cancel as cancelLoopback, onUrl as onLoopbackUrl } from "@fabianlars/tauri-plugin-oauth"
import { openUrl } from "@tauri-apps/plugin-opener"
import { fetch as tauriHttpFetch } from "@tauri-apps/plugin-http"
import { StdioClientTransport } from "./stdio-transport"
import {
  CodezalMcpOAuthProvider,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_PORT,
  type McpOAuthOptions,
} from "./mcp-oauth-provider"
import {
  clearCodeVerifier,
  clearOAuthState,
  getAuth,
  getOAuthState,
  removeAuth,
} from "./mcp-auth"
import { expandShellVars } from "./config/variable"

export type McpServerConfig = {
  // Human label (used as tool-name prefix: <name>__<tool>)
  name: string
  // URL for HTTP/SSE, left empty for stdio
  url: string
  // HTTP/SSE: Authorization etc. headers
  headers?: Record<string, string>
  // "http" (default, StreamableHTTP) | "sse" (legacy) | "stdio" (local subprocess)
  transport?: "http" | "sse" | "stdio"
  // stdio: command + args + env + cwd to spawn
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // OAuth for remote servers. `false` disables auto-detection; an object supplies
  // pre-registered client / scope / redirect overrides. Omitted = auto-detect.
  oauth?: McpOAuthOptions | false
  // Per-request timeout in ms (connect + listTools). Defaults to DEFAULT_TIMEOUT.
  timeout?: number
  // Disabled while underperforming / erroring
  enabled?: boolean
  // If plugin-sourced, which plugin — UI badge + read-only marking
  pluginId?: string
}

export type McpToolInfo = {
  name: string
  description?: string
}

export type McpResourceInfo = {
  name: string
  uri: string
  description?: string
}

export type McpStatus = {
  name: string
  ok: boolean
  toolCount: number
  error?: string
  // Tool list shown to the model (unprefixed name + description). UI preview.
  tools?: McpToolInfo[]
  // Remote server replied 401 / requires OAuth and has no valid stored tokens.
  needsAuth?: boolean
  // Remote OAuth server with stored tokens (connected without prompting).
  authed?: boolean
  // Best-effort counts of non-tool capabilities.
  promptCount?: number
  resourceCount?: number
}

type Cached = {
  name: string
  client: Client
  tools: ToolSet
  toolInfos: McpToolInfo[]
  promptInfos: McpToolInfo[]
  resourceInfos: McpResourceInfo[]
  // Server-provided usage guidance (MCP initialize result.instructions). Many
  // servers omit it; when present it is surfaced into the system prompt.
  instructions?: string
}
const CACHE = new Map<string, Cached>() // key = name + connection-id

const DEFAULT_TIMEOUT = 30_000

// gibi remote sunucularda "Load failed" (CORS preflight reddi) veriyordu.
const mcpFetch = tauriHttpFetch as unknown as typeof globalThis.fetch

// Thrown by connectMcp when a remote server requires OAuth and we have no valid
// tokens. buildMcpTools turns it into a needs_auth status instead of a hard fail.
export class McpAuthRequiredError extends Error {
  serverName: string
  constructor(serverName: string) {
    super(`MCP server "${serverName}" requires authentication`)
    this.name = "McpAuthRequiredError"
    this.serverName = serverName
  }
}

// Thrown by authenticateMcp when the loopback callback server can't be started
// (port busy, permission denied). The caller falls back to manual paste.
export class McpLoopbackUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpLoopbackUnavailableError"
  }
}

async function expandMcpConfig(c: McpServerConfig): Promise<McpServerConfig> {
  if (c.transport !== "stdio") return c
  const [command, cwd, ...expandedArgs] = await Promise.all([
    c.command ? expandShellVars(c.command) : Promise.resolve(c.command),
    c.cwd ? expandShellVars(c.cwd) : Promise.resolve(c.cwd),
    ...(c.args ?? []).map((a) => expandShellVars(a)),
  ])
  let env = c.env
  if (env) {
    const entries = Object.entries(env)
    const values = await Promise.all(entries.map(([, v]) => expandShellVars(v)))
    env = Object.fromEntries(entries.map(([k], i) => [k, values[i]]))
  }
  return { ...c, command, cwd, args: expandedArgs.length ? expandedArgs : c.args, env }
}

function cacheKey(c: McpServerConfig): string {
  if (c.transport === "stdio") {
    return `${c.name}|stdio|${c.command}|${(c.args ?? []).join(" ")}`
  }
  return `${c.name}|${c.url}`
}

function isUnauthorized(e: unknown): boolean {
  if (e instanceof UnauthorizedError) return true
  return e instanceof Error && /unauthor|\boauth\b|\b401\b/i.test(e.message)
}

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

function isOutputSchemaValidationError(e: unknown): boolean {
  return (
    e instanceof Error &&
    /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
      e.message,
    )
  )
}

async function listToolsTolerant(
  client: Client,
  timeout: number,
  name: string,
): Promise<McpToolDef[]> {
  try {
    const res = await withTimeout(client.listTools(), timeout, `listTools ${name}`)
    return res.tools
  } catch (e) {
    if (!isOutputSchemaValidationError(e)) throw e
    console.warn(
      `[mcp ${name}] outputSchema doğrulaması başarısız — outputSchema olmadan tekrar deneniyor`,
    )
    const res = await client.request(
      { method: "tools/list" },
      TolerantListToolsResultSchema,
      { timeout },
    )
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })) as McpToolDef[]
  }
}

function oauthOptions(config: McpServerConfig): McpOAuthOptions {
  return typeof config.oauth === "object" ? config.oauth : {}
}

async function closeQuietly(closable: { close: () => Promise<void> }): Promise<void> {
  try {
    await closable.close()
  } catch {
    // ignore — already closed / never opened
  }
}

// --- tools/list_changed live refresh ---

type ToolsChangedListener = (serverName: string) => void
const toolsChangedListeners = new Set<ToolsChangedListener>()

// Subscribe to MCP tools/list_changed notifications. Returns an unsubscribe fn.
// The cached ToolSet is mutated in place before listeners fire, so a subsequent
// buildAllTools() picks up the new tools without reconnecting.
export function onMcpToolsChanged(fn: ToolsChangedListener): () => void {
  toolsChangedListeners.add(fn)
  return () => toolsChangedListeners.delete(fn)
}

function emitToolsChanged(serverName: string): void {
  for (const fn of toolsChangedListeners) {
    try {
      fn(serverName)
    } catch {
      // a bad listener must not break others
    }
  }
}

// Config → matching transport. authProvider only applies to http/sse.
function buildTransport(config: McpServerConfig, authProvider?: CodezalMcpOAuthProvider) {
  if (config.transport === "stdio") {
    if (!config.command) throw new Error(`MCP stdio: command is empty (${config.name})`)
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    })
  }
  const requestInit = config.headers ? { headers: config.headers } : undefined
  if (config.transport === "sse") {
    return new SSEClientTransport(new URL(config.url), { authProvider, requestInit, fetch: mcpFetch })
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    authProvider,
    requestInit,
    fetch: mcpFetch,
  })
}

// Build a single AI SDK tool wrapping an MCP tool def. Shared by initial connect
// and the tools/list_changed refresh path.
function makeTool(config: McpServerConfig, client: Client, def: McpToolDef): ToolSet[string] {
  return tool({
    description: def.description ?? `(MCP ${config.name})`,
    inputSchema: jsonSchema(def.inputSchema as Record<string, unknown>),
    execute: async (args: unknown) => {
      const res = await client.callTool({
        name: def.name,
        arguments: args as Record<string, unknown>,
      })
      // MCP content[] → single string
      const content = (res.content ?? []) as Array<{ type: string; text?: string }>
      const parts = content
        .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
        .filter(Boolean)
      let text = parts.join("\n") || "(empty)"
      const structured = (res as { structuredContent?: unknown }).structuredContent
      if (structured !== undefined && structured !== null) {
        try {
          text += `${parts.length ? "\n\n" : ""}\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``
        } catch {
          // Intentionally ignored.
        }
      }
      return res.isError ? `[MCP error] ${text}` : text
    },
  })
}

// Fill a cached entry's tools/toolInfos from a tool-def list (clears first).
function populateTools(config: McpServerConfig, client: Client, defs: McpToolDef[], cached: Cached): void {
  for (const k of Object.keys(cached.tools)) delete cached.tools[k]
  cached.toolInfos.length = 0
  for (const def of defs) {
    cached.toolInfos.push({ name: def.name, description: def.description })
    cached.tools[`${config.name}__${def.name}`] = makeTool(config, client, def)
  }
}

// Register the tools/list_changed handler. Servers that don't emit it are fine —
// the handler simply never fires. Wrapped in try/catch in case the client
// rejects an unknown notification schema.
function watchToolsChanged(config: McpServerConfig, client: Client, cached: Cached, timeout: number): void {
  try {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      // Ignore if this client was swapped out / closed.
      if (CACHE.get(cacheKey(config))?.client !== client) return
      try {
        const toolDefs = await listToolsTolerant(client, timeout, config.name)
        populateTools(config, client, toolDefs, cached)
        emitToolsChanged(config.name)
      } catch (e) {
        console.warn(`[mcp ${config.name}] tools/list_changed refresh failed:`, e)
      }
    })
  } catch {
    // server/client doesn't support the notification — fine
  }
}

async function listPromptsSafe(client: Client, timeout: number): Promise<McpToolInfo[]> {
  try {
    const res = await withTimeout(client.listPrompts(), timeout, "listPrompts")
    return res.prompts.map((p) => ({ name: p.name, description: p.description }))
  } catch {
    return [] // server may not implement prompts
  }
}

async function listResourcesSafe(client: Client, timeout: number): Promise<McpResourceInfo[]> {
  try {
    const res = await withTimeout(client.listResources(), timeout, "listResources")
    return res.resources.map((r) => ({ name: r.name, uri: r.uri, description: r.description }))
  } catch {
    return [] // server may not implement resources
  }
}

// Proactively refresh an expired OAuth access token before the first request.
// The SDK transport would otherwise send the stale token, eat a 401, then refresh
// and retry — a wasted round-trip that also fails outright against servers that
// don't emit a clean 401 on expiry (they 403 or silently drop the SSE stream).
// We act only when a refresh_token exists and the access token is at/past expiry
// (60s skew); the SDK's auth() runs the refresh_token grant and persists the new
// tokens via the provider. On failure we stay silent and let the normal connect
// path surface McpAuthRequiredError, exactly as before.
async function preRefreshExpiredOAuth(
  provider: CodezalMcpOAuthProvider,
  serverUrl: string,
): Promise<void> {
  const tokens = await provider.tokens()
  if (!tokens?.refresh_token) return // first-time / no refresh grant to use
  // expires_in is seconds-until-expiry, clamped to >=0 by the provider. undefined
  // means the token carries no expiry info — leave it to the reactive 401 path.
  if (tokens.expires_in === undefined || tokens.expires_in > 60) return
  try {
    await auth(provider, { serverUrl, fetchFn: mcpFetch })
  } catch {
    // Refresh failed (revoked refresh_token, server error). Fall through; the
    // following client.connect() 401s → McpAuthRequiredError, existing behavior.
  }
}

export async function connectMcp(config: McpServerConfig): Promise<Cached> {
  const rawKey = cacheKey(config)
  if (CACHE.has(rawKey)) return CACHE.get(rawKey)!
  const expanded = await expandMcpConfig(config)
  const key = cacheKey(expanded)
  const hit = CACHE.get(key)
  if (hit) return hit

  // Sub-second timeouts abort connect/listTools before any real MCP round-trip
  // can finish → the server silently dies on every call. Ignore a configured
  // value below 1000ms and fall back to DEFAULT_TIMEOUT (30s). Mirrors Claude
  // Code's MCP per-server timeout fix. This is the single resolution point, so it
  // covers both settings-stored configs and JSON-pasted ones.
  const cfgTimeout = expanded.timeout ?? DEFAULT_TIMEOUT
  const timeout = cfgTimeout >= 1000 ? cfgTimeout : DEFAULT_TIMEOUT

  // Attach an OAuth provider for remote servers unless explicitly disabled.
  // onRedirect is a no-op here: startup connects must stay silent. The browser
  // is only opened from the interactive startMcpAuth() flow.
  let authProvider: CodezalMcpOAuthProvider | undefined
  if (expanded.transport !== "stdio" && expanded.oauth !== false) {
    authProvider = new CodezalMcpOAuthProvider(expanded.name, expanded.url, oauthOptions(expanded), {
      onRedirect: () => {},
    })
  }

  // Expired OAuth token → refresh before connecting (see preRefreshExpiredOAuth).
  if (authProvider) await preRefreshExpiredOAuth(authProvider, expanded.url)

  const transport = buildTransport(expanded, authProvider)
  const client = new Client({ name: "codezal", version: "0.1" }, { capabilities: {} })

  try {
    await withTimeout(client.connect(transport), timeout, `connect ${expanded.name}`)
  } catch (e) {
    await closeQuietly(transport)
    if (authProvider && isUnauthorized(e)) throw new McpAuthRequiredError(expanded.name)
    throw e
  }

  const toolDefs = await listToolsTolerant(client, timeout, expanded.name)
  const cached: Cached = {
    name: expanded.name,
    client,
    tools: {},
    toolInfos: [],
    promptInfos: [],
    resourceInfos: [],
  }
  populateTools(expanded, client, toolDefs, cached)
  // Server-provided usage instructions (from the initialize response). Optional —
  // absent for most servers; surfaced into the system prompt when present.
  const instr = client.getInstructions()?.trim()
  if (instr) cached.instructions = instr
  // Best-effort non-tool capabilities — never fatal.
  cached.promptInfos = await listPromptsSafe(client, timeout)
  cached.resourceInfos = await listResourcesSafe(client, timeout)

  CACHE.set(key, cached)
  watchToolsChanged(expanded, client, cached, timeout)

  if (expanded.transport === "sse") {
    let retries = 0
    const MAX_RETRIES = 5
    const BASE_DELAY = 2_000
    client.onclose = () => {
      if (CACHE.get(key)?.client !== client) return
      CACHE.delete(key)
      if (retries >= MAX_RETRIES) {
        console.warn(`[mcp ${expanded.name}] SSE bağlantı kesildi, max retry (${MAX_RETRIES}) aşıldı`)
        return
      }
      const delay = Math.min(BASE_DELAY * 2 ** retries, 30_000)
      retries++
      console.info(`[mcp ${expanded.name}] SSE kesildi → retry ${retries}/${MAX_RETRIES} (${delay}ms sonra)`)
      setTimeout(async () => {
        try {
          await connectMcp(config)
          emitToolsChanged(expanded.name)
          retries = 0
        } catch (e) {
          console.warn(`[mcp ${expanded.name}] SSE reconnect başarısız:`, e)
        }
      }, delay)
    }
  }

  return cached
}

async function buildOne(s: McpServerConfig): Promise<{ tools?: ToolSet; status: McpStatus }> {
  const missingConn = s.transport === "stdio" ? !s.command : !s.url
  if (s.enabled === false || missingConn) {
    return {
      status: {
        name: s.name,
        ok: false,
        toolCount: 0,
        error: s.enabled === false ? "disabled" : "connection empty",
      },
    }
  }
  try {
    const c = await connectMcp(s)
    const isRemoteOAuth = s.transport !== "stdio" && s.oauth !== false
    const authed = isRemoteOAuth ? !!(await getAuth(s.name))?.tokens : undefined
    return {
      tools: c.tools,
      status: {
        name: s.name,
        ok: true,
        toolCount: Object.keys(c.tools).length,
        tools: c.toolInfos,
        promptCount: c.promptInfos.length,
        resourceCount: c.resourceInfos.length,
        authed,
      },
    }
  } catch (e) {
    if (e instanceof McpAuthRequiredError) {
      return {
        status: { name: s.name, ok: false, toolCount: 0, needsAuth: true, error: "authentication required" },
      }
    }
    return {
      status: { name: s.name, ok: false, toolCount: 0, error: errorMessage(e) },
    }
  }
}

export async function buildMcpTools(servers: McpServerConfig[]): Promise<{
  tools: ToolSet
  statuses: McpStatus[]
}> {
  const seen = new Set<string>()
  const uniqueServers = servers.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
  // Connect servers concurrently but bounded — one slow/hung server no longer
  // blocks the rest (each is bounded by its own withTimeout), and many servers
  // no longer spawn all connections at once.
  const results = await pooledMap(8, uniqueServers, buildOne)
  const tools: ToolSet = {}
  const statuses: McpStatus[] = []
  for (const r of results) {
    if (r.tools) Object.assign(tools, r.tools)
    statuses.push(r.status)
  }
  return { tools, statuses }
}

export async function disconnectAll(): Promise<void> {
  for (const [k, c] of CACHE) {
    await closeQuietly(c.client)
    CACHE.delete(k)
  }
}

export async function listMcpStatus(servers: McpServerConfig[]): Promise<McpStatus[]> {
  const { statuses } = await buildMcpTools(servers)
  return statuses
}

// Drop (and close) every cached connection for a server name — forces the next
// buildMcpTools to reconnect, e.g. after auth changes.
function invalidateCacheFor(name: string): void {
  const prefix = `${name}|`
  for (const [k, c] of CACHE) {
    if (k.startsWith(prefix)) {
      void closeQuietly(c.client)
      CACHE.delete(k)
    }
  }
}

// --- OAuth interactive flow (remote servers) ---

type AuthTransport = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, AuthTransport>()

function stashPendingTransport(name: string, transport: AuthTransport): void {
  const prev = pendingOAuthTransports.get(name)
  if (prev && prev !== transport) void closeQuietly(prev)
  pendingOAuthTransports.set(name, transport)
}

function buildAuthTransport(config: McpServerConfig, provider: CodezalMcpOAuthProvider): AuthTransport {
  const url = new URL(config.url)
  const requestInit = config.headers ? { headers: config.headers } : undefined
  return config.transport === "sse"
    ? new SSEClientTransport(url, { authProvider: provider, requestInit, fetch: mcpFetch })
    : new StreamableHTTPClientTransport(url, { authProvider: provider, requestInit, fetch: mcpFetch })
}

// Begin OAuth. Returns the authorization URL the caller must open in a browser,
// or { authed: true } when valid tokens already exist. The SDK performs metadata
// discovery, dynamic client registration and PKCE setup during connect; on the
// expected 401 it hands us the authorization URL via onRedirect.
export async function startMcpAuth(
  config: McpServerConfig,
): Promise<{ authorizationUrl?: string; authed?: boolean }> {
  if (config.transport === "stdio") throw new Error("stdio servers do not use OAuth")
  if (config.oauth === false) throw new Error(`OAuth is disabled for "${config.name}"`)

  let captured: URL | undefined
  const provider = new CodezalMcpOAuthProvider(config.name, config.url, oauthOptions(config), {
    onRedirect: (u) => {
      captured = u
    },
  })
  const transport = buildAuthTransport(config, provider)
  const client = new Client({ name: "codezal", version: "0.1" }, { capabilities: {} })

  try {
    await client.connect(transport)
    // Connected with stored tokens — already authorized.
    await closeQuietly(transport)
    invalidateCacheFor(config.name)
    return { authed: true }
  } catch (e) {
    if (isUnauthorized(e) && captured) {
      // Keep the transport alive: finishMcpAuth() reuses it (it holds the PKCE
      // verifier + discovered endpoints) to exchange the code for tokens.
      stashPendingTransport(config.name, transport)
      return { authorizationUrl: captured.toString() }
    }
    await closeQuietly(transport)
    throw e
  }
}

// Complete OAuth from the full redirected callback URL the user pasted back
// (e.g. http://127.0.0.1:19876/mcp/oauth/callback?code=...&state=...).
export async function finishMcpAuth(config: McpServerConfig, callbackUrl: string): Promise<McpStatus> {
  let u: URL
  try {
    u = new URL(callbackUrl.trim())
  } catch {
    throw new Error("Invalid callback URL")
  }
  const error = u.searchParams.get("error")
  if (error) throw new Error(`Authorization server returned: ${error}`)
  const code = u.searchParams.get("code")
  if (!code) throw new Error("Callback URL is missing the ?code= parameter")

  // CSRF: the returned state must match the one we generated at startAuth.
  const state = u.searchParams.get("state")
  const stored = await getOAuthState(config.name)
  // If we generated a state at startAuth, the callback MUST echo it back — a
  // missing `state` is as suspicious as a mismatched one. Only skip when we
  // never stored one (server without state support).
  if (stored && stored !== state) {
    throw new Error("OAuth state mismatch — possible CSRF, aborting")
  }

  const transport = pendingOAuthTransports.get(config.name)
  if (!transport) throw new Error("No pending OAuth flow — click Authenticate first")

  // Exchanges the code for tokens; the provider persists them via saveTokens.
  await transport.finishAuth(code)
  await closeQuietly(transport)
  pendingOAuthTransports.delete(config.name)
  await clearOAuthState(config.name)
  await clearCodeVerifier(config.name)
  invalidateCacheFor(config.name)

  // Reconnect to confirm the tokens work and refresh the status.
  const [status] = await listMcpStatus([config])
  return status
}

// Full auto-capture OAuth: starts a 127.0.0.1 loopback server (tauri-plugin-oauth),
// opens the browser, waits for the redirect and exchanges the code — no manual
// paste. The plugin serves a page whose script posts window.location.href back,
// so any redirect path works. Throws McpLoopbackUnavailableError when the server
// can't bind; callers then fall back to startMcpAuth()/finishMcpAuth().
export async function authenticateMcp(config: McpServerConfig): Promise<McpStatus> {
  if (config.transport === "stdio") throw new Error("stdio servers do not use OAuth")
  if (config.oauth === false) throw new Error(`OAuth is disabled for "${config.name}"`)

  const preferredPort =
    (typeof config.oauth === "object" && config.oauth.callbackPort) || OAUTH_CALLBACK_PORT
  let port: number
  try {
    port = await startLoopback({ ports: [preferredPort] })
  } catch (e) {
    throw new McpLoopbackUnavailableError(errorMessage(e))
  }

  let unlisten: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let resolveUrl!: (u: string) => void
    let rejectUrl!: (e: Error) => void
    const callbackUrl = new Promise<string>((res, rej) => {
      resolveUrl = res
      rejectUrl = rej
    })
    timer = setTimeout(
      () => rejectUrl(new Error("OAuth timed out waiting for the browser redirect")),
      180_000,
    )
    unlisten = await onLoopbackUrl((url) => resolveUrl(url))

    const redirectUri = `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
    const provider = new CodezalMcpOAuthProvider(
      config.name,
      config.url,
      { ...oauthOptions(config), redirectUri },
      {
        onRedirect: async (authUrl) => {
          try {
            await openUrl(authUrl.toString())
          } catch {
            // Browser open failed; user can still complete in an already-open tab.
          }
        },
      },
    )
    const transport = buildAuthTransport(config, provider)
    const client = new Client({ name: "codezal", version: "0.1" }, { capabilities: {} })

    try {
      await client.connect(transport)
      // Connected with stored tokens — already authorized.
      await closeQuietly(transport)
      invalidateCacheFor(config.name)
      const [status] = await listMcpStatus([config])
      return status
    } catch (e) {
      if (!isUnauthorized(e)) {
        await closeQuietly(transport)
        throw e
      }
      // onRedirect already opened the browser; keep the transport for token exchange.
      stashPendingTransport(config.name, transport)
    }

    const url = await callbackUrl
    return await finishMcpAuth(config, url)
  } finally {
    if (timer) clearTimeout(timer)
    if (unlisten) unlisten()
    await cancelLoopback(port).catch(() => {})
    const leftover = pendingOAuthTransports.get(config.name)
    if (leftover) {
      pendingOAuthTransports.delete(config.name)
      await closeQuietly(leftover).catch(() => {})
    }
  }
}

// Forget stored OAuth credentials and drop any cached connection.
export async function removeMcpAuth(name: string): Promise<void> {
  await removeAuth(name)
  pendingOAuthTransports.delete(name)
  invalidateCacheFor(name)
}

// --- Prompts / resources ---

// Prompts of already-connected servers, read from cache (no connect/network).
// Composer surfaces these as slash commands; empty until a server connects.
export function listConnectedMcpPrompts(): { server: string; prompts: McpToolInfo[] }[] {
  const out: { server: string; prompts: McpToolInfo[] }[] = []
  for (const c of CACHE.values()) {
    if (c.promptInfos.length) out.push({ server: c.name, prompts: c.promptInfos })
  }
  return out
}

// Resources of already-connected servers, read from cache (no connect/network).
// Composer surfaces these as @-mentions; empty until a server connects.
export function listConnectedMcpResources(): { server: string; resources: McpResourceInfo[] }[] {
  const out: { server: string; resources: McpResourceInfo[] }[] = []
  for (const c of CACHE.values()) {
    if (c.resourceInfos.length) out.push({ server: c.name, resources: c.resourceInfos })
  }
  return out
}

// Server instructions of already-connected servers (MCP initialize
// result.instructions), read from cache (no connect/network). Folded into the
// system prompt so the model follows each server's usage guidance. Empty until
// a server that provides instructions connects.
export function listConnectedMcpInstructions(): { server: string; text: string }[] {
  const out: { server: string; text: string }[] = []
  for (const c of CACHE.values()) {
    if (c.instructions) out.push({ server: c.name, text: c.instructions })
  }
  return out
}

export async function listMcpPrompts(config: McpServerConfig): Promise<McpToolInfo[]> {
  return (await connectMcp(config)).promptInfos
}

export async function listMcpResources(config: McpServerConfig): Promise<McpResourceInfo[]> {
  return (await connectMcp(config)).resourceInfos
}

export async function getMcpPrompt(
  config: McpServerConfig,
  name: string,
  args?: Record<string, string>,
): Promise<Awaited<ReturnType<Client["getPrompt"]>>> {
  const { client } = await connectMcp(config)
  return client.getPrompt({ name, arguments: args })
}

export async function readMcpResource(
  config: McpServerConfig,
  uri: string,
): Promise<Awaited<ReturnType<Client["readResource"]>>> {
  const { client } = await connectMcp(config)
  return client.readResource({ uri })
}

// Parses Claude Desktop / Cursor / VSCode style MCP server JSON.
// Three accepted root shapes:
//   { "mcpServers": { "name": { command/args/env | url/headers } } }   (Claude Desktop / Cursor)
//   { "servers":    { "name": { command/args/env | url/headers } } }   (VS Code / Visual Studio)
//   { "name": { ... } }                                                (no top-level wrapper)
// Transport is auto-detected per entry:
//   command present → stdio, url present → http (type="sse" forces sse).
// Throws on: invalid JSON, missing expected fields.
export function parseMcpServersJson(text: string): McpServerConfig[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(`Invalid JSON: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON root must be an object")
  }
  const root = parsed as Record<string, unknown>
  // Wrapper key: "mcpServers" (Claude Desktop / Cursor) or "servers" (VS Code / Visual Studio).
  // Fall back to root itself for the unwrapped { "name": {...} } shape.
  const map =
    root.mcpServers && typeof root.mcpServers === "object"
      ? (root.mcpServers as Record<string, unknown>)
      : root.servers && typeof root.servers === "object"
        ? (root.servers as Record<string, unknown>)
        : root
  const out: McpServerConfig[] = []
  for (const [name, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const hasCommand = typeof r.command === "string" && r.command.length > 0
    const hasUrl = typeof r.url === "string" && r.url.length > 0
    if (!hasCommand && !hasUrl) {
      throw new Error(`'${name}': command or url field is required`)
    }
    const explicitType =
      typeof r.type === "string"
        ? (r.type as string).toLowerCase()
        : typeof r.transport === "string"
          ? (r.transport as string).toLowerCase()
          : undefined
    let transport: McpServerConfig["transport"]
    if (explicitType === "stdio" || explicitType === "sse" || explicitType === "http") {
      transport = explicitType
    } else {
      transport = hasCommand ? "stdio" : "http"
    }
    const cfg: McpServerConfig = {
      name,
      url: typeof r.url === "string" ? r.url : "",
      transport,
      enabled: r.disabled === true ? false : true,
    }
    if (transport === "stdio") {
      cfg.command = (r.command as string | undefined) ?? ""
      cfg.args = Array.isArray(r.args) ? (r.args as unknown[]).map(String) : undefined
      if (r.env && typeof r.env === "object") {
        cfg.env = r.env as Record<string, string>
      }
      if (typeof r.cwd === "string") cfg.cwd = r.cwd
    } else {
      if (r.headers && typeof r.headers === "object") {
        cfg.headers = r.headers as Record<string, string>
      }
      // OAuth: false disables; an object supplies clientId/scope/redirect overrides.
      if (r.oauth === false) cfg.oauth = false
      else if (r.oauth && typeof r.oauth === "object") cfg.oauth = r.oauth as McpOAuthOptions
    }
    if (typeof r.timeout === "number" && r.timeout > 0) cfg.timeout = r.timeout
    out.push(cfg)
  }
  if (out.length === 0) {
    throw new Error("No servers found in JSON")
  }
  return out
}

// Plugin-sourced MCP servers — registered by the plugin loader.
// buildMcpTools is called with settings.mcpServers + listPluginMcps() merged.
const pluginMcps: McpServerConfig[] = []

export function listPluginMcps(): McpServerConfig[] {
  return [...pluginMcps]
}

export function _registerPluginMcp(m: McpServerConfig): void {
  const idx = pluginMcps.findIndex(
    (x) => x.name === m.name && x.pluginId === m.pluginId,
  )
  if (idx >= 0) pluginMcps.splice(idx, 1, m)
  else pluginMcps.push(m)
}

export function _unregisterPluginMcps(pluginId: string): void {
  for (let i = pluginMcps.length - 1; i >= 0; i--) {
    if (pluginMcps[i].pluginId === pluginId) pluginMcps.splice(i, 1)
  }
}

export function _clearPluginMcps(): void {
  pluginMcps.length = 0
}
