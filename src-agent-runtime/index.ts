import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import path from "node:path"
import { URL } from "node:url"
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk"

type ProviderId = "codex-cli" | "claude-cli"
type RpcId = string | number
type RuntimeMode = "ask" | "auto-review" | "bypass" | "plan"

type ProviderRuntimeSettings = {
  command?: string
  env?: Record<string, string>
  injectCodezalTools?: boolean
  models?: string[]
}

type McpToolDefinition = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

type McpToolCallResult = {
  content?: Array<{ type: "text"; text: string }>
  structuredContent?: unknown
  isError?: boolean
}

type ProviderModel = {
  id: string
  label?: string
  description?: string
  source?: "runtime" | "custom" | "fallback"
}

type RuntimeSession = {
  id: string
  providerId: ProviderId
  ownerSessionId?: string
  cwd?: string
  model?: string
  mode: RuntimeMode
  injectCodezalTools?: boolean
  nativeHandle?: string
  codex?: CodexAppServerClient
  activeTurnId?: string
  activeAbort?: AbortController
}

type RuntimeEvent =
  | { type: "thread_started"; providerId: ProviderId; sessionId: string; nativeHandle?: string }
  | { type: "turn_started"; providerId: ProviderId; sessionId: string; turnId: string }
  | { type: "text_delta"; providerId: ProviderId; sessionId: string; turnId?: string; delta: string }
  | { type: "reasoning_delta"; providerId: ProviderId; sessionId: string; turnId?: string; delta: string }
  | { type: "tool_call"; providerId: ProviderId; sessionId: string; turnId?: string; id: string; name: string; input?: unknown }
  | { type: "tool_result"; providerId: ProviderId; sessionId: string; turnId?: string; id: string; name: string; output?: string; isError?: boolean }
  | { type: "permission_requested"; providerId: ProviderId; sessionId: string; turnId?: string; request: PermissionRequest }
  | { type: "permission_resolved"; providerId: ProviderId; sessionId: string; turnId?: string; requestId: string; decision: "allow" | "deny" }
  | { type: "usage"; providerId: ProviderId; sessionId: string; turnId?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; costUsd?: number }
  | { type: "turn_completed"; providerId: ProviderId; sessionId: string; turnId: string; nativeHandle?: string }
  | { type: "turn_failed"; providerId: ProviderId; sessionId: string; turnId: string; error: string }
  | { type: "turn_canceled"; providerId: ProviderId; sessionId: string; turnId: string }
  | { type: "stderr"; providerId?: ProviderId; sessionId?: string; turnId?: string; line: string }

type PermissionRequest = {
  id: string
  providerId: ProviderId
  name: string
  title: string
  input?: unknown
  metadata?: Record<string, unknown>
}

type PermissionWaiter = {
  providerId: ProviderId
  sessionId: string
  turnId?: string
  kind: "command" | "file" | "question" | "tool"
  resolve: (decision: "allow" | "deny") => void
}

const sessions = new Map<string, RuntimeSession>()
const permissionWaiters = new Map<string, PermissionWaiter>()
const hostWaiters = new Map<
  RpcId,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>()
let inputBuffer = ""
let hostRequestSeq = 1
let mcpServerPromise: Promise<{ server: Server; port: number }> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id: RpcId, result: unknown): void {
  writeMessage({ id, result })
}

function rejectRequest(id: RpcId, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  writeMessage({ id, error: { message } })
}

function emit(event: RuntimeEvent): void {
  writeMessage({ event })
}

function requestHost<T = unknown>(method: string, params: unknown, timeoutMs = 120_000): Promise<T> {
  const id = `host-${hostRequestSeq++}`
  writeMessage({ request: { id, method, params } })
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      hostWaiters.delete(id)
      reject(new Error(`Host request timed out: ${method}`))
    }, timeoutMs)
    hostWaiters.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    })
  })
}

function handleHostResponse(message: Record<string, unknown>): boolean {
  const id = message.id as RpcId | undefined
  if (id == null || !hostWaiters.has(id)) return false
  const waiter = hostWaiters.get(id)!
  clearTimeout(waiter.timer)
  hostWaiters.delete(id)
  if (isRecord(message.error)) waiter.reject(new Error(String(message.error.message ?? "Host request failed")))
  else waiter.resolve(message.result)
  return true
}

function parseCommand(command: string | undefined, fallback: string[]): string[] {
  if (!command?.trim()) return fallback
  const out: string[] = []
  let cur = ""
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of command.trim()) {
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out.length ? out : fallback
}

function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which"
  const result = spawnSync(probe, [command], { stdio: "ignore" })
  return result.status === 0
}

function commandVersion(command: string, args: string[] = ["--version"]): string | null {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
    })
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    return result.status === 0 && text ? text.split(/\r?\n/)[0] : null
  } catch {
    return null
  }
}

async function diagnoseProvider(providerId: ProviderId, settings?: ProviderRuntimeSettings) {
  const command = parseCommand(settings?.command, providerId === "codex-cli" ? ["codex"] : ["claude"])[0]
  const exists = commandExists(command)
  const version = exists ? commandVersion(command) : null
  const runtime = {
    bun: typeof process.versions.bun === "string" ? process.versions.bun : null,
    node: process.versions.node ?? null,
  }
  if (providerId === "claude-cli") {
    let sdk = false
    let sdkError: string | null = null
    try {
      await import("@anthropic-ai/claude-agent-sdk")
      sdk = true
    } catch (error) {
      sdkError = error instanceof Error ? error.message : String(error)
    }
    return { providerId, command, exists, version, runtime, sdk, sdkError }
  }
  return { providerId, command, exists, version, runtime, sdk: null, sdkError: null }
}

const CODEX_MODELS: ProviderModel[] = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Frontier coding and reasoning model.",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Strong default model for everyday coding.",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Fast, cost-efficient model for smaller coding tasks.",
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    description: "Ultra-fast coding model.",
  },
]

const CLAUDE_MODELS: ProviderModel[] = [
  { id: "opus-4.6", label: "Opus 4.6", description: "Highest capability Claude coding model." },
  { id: "sonnet-4.6", label: "Sonnet 4.6", description: "Balanced default Claude coding model." },
  { id: "haiku-4.6", label: "Haiku 4.6", description: "Fast Claude model for small tasks." },
  { id: "opus-4.5", label: "Opus 4.5" },
  { id: "sonnet-4.5", label: "Sonnet 4.5" },
  { id: "haiku-4.5", label: "Haiku 4.5" },
  { id: "opus-4.1", label: "Opus 4.1" },
  { id: "sonnet-4", label: "Sonnet 4" },
  { id: "haiku-3.5", label: "Haiku 3.5" },
  { id: "sonnet-3.7", label: "Sonnet 3.7" },
  { id: "opus-3", label: "Opus 3" },
]

function providerModels(providerId: ProviderId, settings?: ProviderRuntimeSettings): ProviderModel[] {
  const custom = settings?.models
    ?.map((model) => model.trim())
    .filter(Boolean)
    .map((model) => ({ id: model, label: model, source: "custom" as const }))
  if (custom?.length) return custom
  const defaults = providerId === "codex-cli" ? CODEX_MODELS : CLAUDE_MODELS
  return defaults.map((model) => ({ ...model, source: "runtime" }))
}

function modeForCodex(mode: RuntimeMode): { modeId: string; approvalPolicy: string; sandbox: string; networkAccess?: boolean; approvalsReviewer?: "auto_review" } {
  if (mode === "bypass") {
    return { modeId: "full-access", approvalPolicy: "never", sandbox: "danger-full-access", networkAccess: true }
  }
  if (mode === "auto-review") {
    return { modeId: "auto-review", approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "auto_review" }
  }
  if (mode === "plan") {
    return { modeId: "read-only", approvalPolicy: "on-request", sandbox: "read-only" }
  }
  return { modeId: "auto", approvalPolicy: "on-request", sandbox: "workspace-write" }
}

function modeForClaude(mode: RuntimeMode): string {
  if (mode === "bypass") return "bypassPermissions"
  if (mode === "auto-review") return "auto"
  if (mode === "plan") return "plan"
  return "default"
}

function spawnProcess(argv: string[], opts: { cwd?: string; env?: Record<string, string> }): ChildProcessWithoutNullStreams {
  const [command, ...args] = argv
  if (!command) throw new Error("Missing command")
  return spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32" && !path.isAbsolute(command),
  })
}

async function ensureCodezalMcpServer(): Promise<{ server: Server; port: number }> {
  if (mcpServerPromise) return await mcpServerPromise
  mcpServerPromise = new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleMcpHttpRequest(req, res)
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Codezal MCP server did not bind to a TCP port"))
        return
      }
      resolve({ server, port: address.port })
    })
  })
  return await mcpServerPromise
}

async function codezalMcpUrl(session: RuntimeSession): Promise<string | null> {
  if (session.injectCodezalTools === false || !session.ownerSessionId) return null
  const { port } = await ensureCodezalMcpServer()
  return `http://127.0.0.1:${port}/mcp?sessionId=${encodeURIComponent(session.id)}`
}

async function codezalMcpForCodex(session: RuntimeSession): Promise<Record<string, unknown> | null> {
  const url = await codezalMcpUrl(session)
  return url ? { mcp_servers: { codezal: { url } } } : null
}

async function codezalMcpForClaude(session: RuntimeSession): Promise<Record<string, McpServerConfig> | undefined> {
  const url = await codezalMcpUrl(session)
  return url ? { codezal: { type: "http", url, alwaysLoad: true } } : undefined
}

async function handleMcpHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null })
    return
  }
  try {
    const url = new URL(req.url ?? "/mcp", "http://127.0.0.1")
    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: null })
      return
    }
    const runtimeSessionId = url.searchParams.get("sessionId") ?? ""
    const body = JSON.parse(await readBody(req)) as unknown
    const batch = Array.isArray(body) ? body : [body]
    const responses = (
      await Promise.all(batch.map((message) => handleMcpMessage(runtimeSessionId, message)))
    ).filter(Boolean)
    if (responses.length === 0) {
      res.writeHead(202).end()
      return
    }
    sendJson(res, 200, Array.isArray(body) ? responses : responses[0])
  } catch (error) {
    sendJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      id: null,
    })
  }
}

async function handleMcpMessage(runtimeSessionId: string, message: unknown): Promise<Record<string, unknown> | null> {
  if (!isRecord(message)) return mcpError(null, -32600, "Invalid request")
  const id = message.id as RpcId | undefined
  const method = typeof message.method === "string" ? message.method : ""
  const params = isRecord(message.params) ? message.params : {}
  if (id == null && method.startsWith("notifications/")) return null
  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "codezal", version: "0.1.0" },
          },
        }
      case "tools/list":
        return { jsonrpc: "2.0", id, result: await listCodezalMcpTools(runtimeSessionId) }
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : ""
        return {
          jsonrpc: "2.0",
          id,
          result: await callCodezalMcpTool(runtimeSessionId, name, params.arguments),
        }
      }
      default:
        return mcpError(id ?? null, -32601, `Unknown method: ${method}`)
    }
  } catch (error) {
    return mcpError(id ?? null, -32603, error instanceof Error ? error.message : String(error))
  }
}

async function listCodezalMcpTools(runtimeSessionId: string): Promise<{ tools: McpToolDefinition[] }> {
  const session = sessionForMcp(runtimeSessionId)
  const result = await requestHost<{ tools?: McpToolDefinition[] }>(
    "codezalTools/list",
    {
      runtimeSessionId,
      ownerSessionId: session.ownerSessionId,
      providerId: session.providerId,
      cwd: session.cwd,
    },
    120_000,
  )
  return { tools: result.tools ?? [] }
}

async function callCodezalMcpTool(runtimeSessionId: string, name: string, args: unknown): Promise<McpToolCallResult> {
  const session = sessionForMcp(runtimeSessionId)
  const toolCallId = `codezal-${randomUUID()}`
  emit({
    type: "tool_call",
    providerId: session.providerId,
    sessionId: session.id,
    turnId: session.activeTurnId,
    id: toolCallId,
    name: `codezal.${name}`,
    input: args,
  })
  const result = await requestHost<McpToolCallResult>(
    "codezalTools/call",
    {
      runtimeSessionId,
      ownerSessionId: session.ownerSessionId,
      providerId: session.providerId,
      cwd: session.cwd,
      name,
      arguments: args,
      toolCallId,
    },
    15 * 60_000,
  )
  emit({
    type: "tool_result",
    providerId: session.providerId,
    sessionId: session.id,
    turnId: session.activeTurnId,
    id: toolCallId,
    name: `codezal.${name}`,
    output: result.content?.map((part) => part.text).join("\n") ?? "",
    isError: result.isError,
  })
  return result
}

function sessionForMcp(runtimeSessionId: string): RuntimeSession {
  const session = sessions.get(runtimeSessionId)
  if (!session) throw new Error(`Unknown Codezal MCP session: ${runtimeSessionId}`)
  if (!session.ownerSessionId) throw new Error("Codezal MCP session is missing owner session")
  return session
}

function mcpError(id: RpcId | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      body += chunk
    })
    req.on("end", () => resolve(body || "{}"))
    req.on("error", reject)
  })
}

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ""
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private argv: string[],
    private opts: {
      cwd?: string
      env?: Record<string, string>
      onNotification: (method: string, params: unknown) => void
      onRequest: (method: string, params: unknown) => Promise<unknown>
      onStderr: (line: string) => void
    },
  ) {}

  async start(): Promise<void> {
    if (this.child) return
    this.child = spawnProcess(this.argv, this.opts)
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk))
    this.child.stderr.on("data", (chunk: string) => this.opts.onStderr(chunk))
    this.child.on("exit", (code, signal) => {
      const err = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`)
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(err)
      }
      this.pending.clear()
      this.child = null
    })
    await this.request("initialize", {
      clientInfo: { name: "Codezal", version: "0.1.0" },
    }).catch(() => undefined)
    this.notify("initialized", {})
  }

  request(method: string, params?: unknown, timeoutMs = 14 * 24 * 60 * 60 * 1000): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Codex app-server is not running"))
    const id = this.nextId++
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  notify(method: string, params?: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  dispose(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error("Codex app-server closed"))
    }
    this.pending.clear()
    this.child?.kill()
    this.child = null
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf("\n")
    while (idx >= 0) {
      const raw = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (raw) void this.handleLine(raw)
      idx = this.buffer.indexOf("\n")
    }
  }

  private async handleLine(raw: string): Promise<void> {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(msg)) return
    const id = typeof msg.id === "number" ? msg.id : null
    const method = typeof msg.method === "string" ? msg.method : null
    if (id !== null && method) {
      try {
        const result = await this.opts.onRequest(method, msg.params)
        this.child?.stdin.write(`${JSON.stringify({ id, result })}\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.child?.stdin.write(`${JSON.stringify({ id, error: { message } })}\n`)
      }
      return
    }
    if (id !== null) {
      const waiter = this.pending.get(id)
      if (!waiter) return
      clearTimeout(waiter.timer)
      this.pending.delete(id)
      if (isRecord(msg.error)) waiter.reject(new Error(String(msg.error.message ?? "Codex app-server error")))
      else waiter.resolve(msg.result)
      return
    }
    if (method) this.opts.onNotification(method, msg.params)
  }
}

function readThreadId(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined
  const thread = response.thread
  if (isRecord(thread) && typeof thread.id === "string") return thread.id
  if (typeof response.threadId === "string") return response.threadId
  return undefined
}

async function ensureCodexSession(session: RuntimeSession, settings?: ProviderRuntimeSettings): Promise<void> {
  if (session.codex) return
  const argv = parseCommand(settings?.command, ["codex", "app-server"])
  session.codex = new CodexAppServerClient(argv, {
    cwd: session.cwd,
    env: settings?.env,
    onNotification: (method, params) => handleCodexNotification(session, method, params),
    onRequest: (method, params) => handleCodexRequest(session, method, params),
    onStderr: (line) => emit({ type: "stderr", providerId: "codex-cli", sessionId: session.id, turnId: session.activeTurnId, line }),
  })
  await session.codex.start()
  if (session.nativeHandle) {
    const config = await codezalMcpForCodex(session)
    await session.codex.request("thread/resume", {
      threadId: session.nativeHandle,
      ...(config ? { config } : {}),
    }).catch(() => undefined)
  }
}

async function ensureCodexThread(session: RuntimeSession, settings?: ProviderRuntimeSettings, systemPrompt?: string): Promise<string> {
  await ensureCodexSession(session, settings)
  if (session.nativeHandle) return session.nativeHandle
  const preset = modeForCodex(session.mode)
  const config = await codezalMcpForCodex(session)
  const response = await session.codex!.request("thread/start", {
    model: session.model,
    cwd: session.cwd ?? null,
    approvalPolicy: preset.approvalPolicy,
    sandbox: preset.sandbox,
    ...(config ? { config } : {}),
    ...(preset.approvalsReviewer ? { approvalsReviewer: preset.approvalsReviewer } : {}),
    ...(systemPrompt ? { developerInstructions: systemPrompt } : {}),
  })
  const threadId = readThreadId(response)
  if (!threadId) throw new Error("Codex app-server did not return a thread id")
  session.nativeHandle = threadId
  emit({ type: "thread_started", providerId: "codex-cli", sessionId: session.id, nativeHandle: threadId })
  return threadId
}

async function runCodexTurn(session: RuntimeSession, turnId: string, prompt: string, settings?: ProviderRuntimeSettings, systemPrompt?: string): Promise<void> {
  const threadId = await ensureCodexThread(session, settings, systemPrompt)
  const preset = modeForCodex(session.mode)
  await session.codex!.request("turn/start", {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    approvalPolicy: preset.approvalPolicy,
    sandboxPolicy: preset.sandbox === "danger-full-access"
      ? { type: "dangerFullAccess" }
      : preset.sandbox === "read-only"
        ? { type: "readOnly" }
        : { type: "workspaceWrite", networkAccess: preset.networkAccess ?? false },
    ...(session.model ? { model: session.model } : {}),
    ...(systemPrompt ? { developerInstructions: systemPrompt } : {}),
    ...(preset.approvalsReviewer ? { approvalsReviewer: preset.approvalsReviewer } : {}),
  })
}

function handleCodexNotification(session: RuntimeSession, method: string, params: unknown): void {
  const turnId = session.activeTurnId
  if (method === "thread/started") {
    const threadId = readThreadId(params)
    if (threadId) {
      session.nativeHandle = threadId
      emit({ type: "thread_started", providerId: "codex-cli", sessionId: session.id, nativeHandle: threadId })
    }
    return
  }
  if (method === "turn/started") {
    const tid = isRecord(params) && isRecord(params.turn) && typeof params.turn.id === "string" ? params.turn.id : turnId
    if (tid) {
      session.activeTurnId = tid
      emit({ type: "turn_started", providerId: "codex-cli", sessionId: session.id, turnId: tid })
    }
    return
  }
  if (method === "item/agentMessage/delta" || method === "item/agent_message/delta") {
    const delta = isRecord(params) && typeof params.delta === "string" ? params.delta : ""
    if (delta) emit({ type: "text_delta", providerId: "codex-cli", sessionId: session.id, turnId, delta })
    return
  }
  if (method === "item/reasoning/summaryTextDelta") {
    const delta = isRecord(params) && typeof params.delta === "string" ? params.delta : ""
    if (delta) emit({ type: "reasoning_delta", providerId: "codex-cli", sessionId: session.id, turnId, delta })
    return
  }
  if (method === "thread/tokenUsage/updated" && isRecord(params)) {
    const usage = isRecord(params.tokenUsage) ? params.tokenUsage : params
    emit({
      type: "usage",
      providerId: "codex-cli",
      sessionId: session.id,
      turnId,
      inputTokens: firstNumber(usage.inputTokens, usage.input_tokens, usage.promptTokens),
      outputTokens: firstNumber(usage.outputTokens, usage.output_tokens, usage.completionTokens),
      reasoningTokens: firstNumber(usage.reasoningTokens, usage.reasoning_tokens),
    })
    return
  }
  if (method === "exec_command/begin" || method === "item/commandExecution/begin") {
    const itemId = readString(params, "itemId") ?? readString(params, "id") ?? randomUUID()
    const command = readString(params, "command") ?? "shell"
    emit({ type: "tool_call", providerId: "codex-cli", sessionId: session.id, turnId, id: itemId, name: command, input: params })
    return
  }
  if (method === "exec_command/end" || method === "item/commandExecution/end") {
    const itemId = readString(params, "itemId") ?? readString(params, "id") ?? randomUUID()
    const command = readString(params, "command") ?? "shell"
    emit({ type: "tool_result", providerId: "codex-cli", sessionId: session.id, turnId, id: itemId, name: command, output: readString(params, "output") ?? "", isError: false })
    return
  }
  if (method === "turn/completed") {
    const status = isRecord(params) && isRecord(params.turn) && typeof params.turn.status === "string" ? params.turn.status : "completed"
    const error = isRecord(params) && isRecord(params.turn) && isRecord(params.turn.error) ? String(params.turn.error.message ?? "") : ""
    if (status === "failed" && error) {
      if (turnId) emit({ type: "turn_failed", providerId: "codex-cli", sessionId: session.id, turnId, error })
    } else if (turnId) {
      emit({ type: "turn_completed", providerId: "codex-cli", sessionId: session.id, turnId, nativeHandle: session.nativeHandle })
    }
    session.activeTurnId = undefined
  }
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

async function handleCodexRequest(session: RuntimeSession, method: string, params: unknown): Promise<unknown> {
  if (!method.includes("requestApproval") && !method.includes("requestUserInput")) return null
  const itemId = readString(params, "itemId") ?? randomUUID()
  const requestId = `permission-${itemId}`
  const kind = method.includes("fileChange")
    ? "file"
    : method.includes("requestUserInput") || method.includes("tool/requestUserInput")
      ? "question"
      : "command"
  const command = readString(params, "command")
  const title = kind === "file" ? "Apply file changes" : kind === "question" ? "Question" : command ? `Run command: ${command}` : "Run command"
  emit({
    type: "permission_requested",
    providerId: "codex-cli",
    sessionId: session.id,
    turnId: session.activeTurnId,
    request: {
      id: requestId,
      providerId: "codex-cli",
      name: kind === "file" ? "CodexFileChange" : kind === "question" ? "request_user_input" : "CodexBash",
      title,
      input: params,
      metadata: isRecord(params) ? { ...params } : undefined,
    },
  })
  const decision = await new Promise<"allow" | "deny">((resolve) => {
    permissionWaiters.set(requestId, {
      providerId: "codex-cli",
      sessionId: session.id,
      turnId: session.activeTurnId,
      kind,
      resolve,
    })
  })
  emit({ type: "permission_resolved", providerId: "codex-cli", sessionId: session.id, turnId: session.activeTurnId, requestId, decision })
  if (kind === "question") return { answers: {} }
  return { decision: decision === "allow" ? "accept" : "decline" }
}

async function runClaudeTurn(session: RuntimeSession, turnId: string, prompt: string, settings?: ProviderRuntimeSettings, systemPrompt?: string): Promise<void> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  const abortController = new AbortController()
  session.activeAbort = abortController
  const argv = parseCommand(settings?.command, ["claude"])
  let sawStreamDelta = false
  const mcpServers = await codezalMcpForClaude(session)
  const query = sdk.query({
    prompt,
    options: {
      cwd: session.cwd,
      model: session.model,
      resume: session.nativeHandle,
      permissionMode: modeForClaude(session.mode) as never,
      ...(session.mode === "bypass" ? { allowDangerouslySkipPermissions: true } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      includePartialMessages: true,
      abortController,
      pathToClaudeCodeExecutable: argv[0],
      env: { ...process.env, ...settings?.env },
      systemPrompt: systemPrompt
        ? { type: "preset", preset: "claude_code", append: systemPrompt }
        : { type: "preset", preset: "claude_code" },
      canUseTool: async (_toolName: string, input: Record<string, unknown>, options: { toolUseID: string; requestId: string }) => {
        if (_toolName.startsWith("mcp__codezal__")) {
          return { behavior: "allow", toolUseID: options.toolUseID }
        }
        const requestId = options.requestId || `permission-${options.toolUseID}`
        emit({
          type: "permission_requested",
          providerId: "claude-cli",
          sessionId: session.id,
          turnId,
          request: {
            id: requestId,
            providerId: "claude-cli",
            name: _toolName,
            title: _toolName,
            input,
            metadata: { toolUseID: options.toolUseID },
          },
        })
        const decision = await new Promise<"allow" | "deny">((resolve) => {
          permissionWaiters.set(requestId, {
            providerId: "claude-cli",
            sessionId: session.id,
            turnId,
            kind: "tool",
            resolve,
          })
        })
        emit({ type: "permission_resolved", providerId: "claude-cli", sessionId: session.id, turnId, requestId, decision })
        return decision === "allow"
          ? { behavior: "allow", toolUseID: options.toolUseID }
          : { behavior: "deny", message: "Permission denied", toolUseID: options.toolUseID }
      },
      stderr: (line: string) => emit({ type: "stderr", providerId: "claude-cli", sessionId: session.id, turnId, line }),
    },
  })
  emit({ type: "turn_started", providerId: "claude-cli", sessionId: session.id, turnId })
  for await (const msg of query as AsyncIterable<Record<string, unknown>>) {
    if (typeof msg.session_id === "string") session.nativeHandle = msg.session_id
    if (msg.type === "stream_event") {
      sawStreamDelta = handleClaudeStreamEvent(session, turnId, msg.event) || sawStreamDelta
    } else if (msg.type === "assistant" && !sawStreamDelta) {
      const text = extractClaudeAssistantText(msg.message)
      if (text) emit({ type: "text_delta", providerId: "claude-cli", sessionId: session.id, turnId, delta: text })
    } else if (msg.type === "result") {
      const usage = isRecord(msg.usage) ? msg.usage : undefined
      emit({
        type: "usage",
        providerId: "claude-cli",
        sessionId: session.id,
        turnId,
        inputTokens: firstNumber(usage?.input_tokens, usage?.inputTokens),
        outputTokens: firstNumber(usage?.output_tokens, usage?.outputTokens),
        costUsd: firstNumber(msg.total_cost_usd),
      })
    }
  }
  emit({ type: "turn_completed", providerId: "claude-cli", sessionId: session.id, turnId, nativeHandle: session.nativeHandle })
}

function handleClaudeStreamEvent(session: RuntimeSession, turnId: string, event: unknown): boolean {
  if (!isRecord(event)) return false
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    const delta = event.delta
    if (typeof delta.text === "string") {
      emit({ type: "text_delta", providerId: "claude-cli", sessionId: session.id, turnId, delta: delta.text })
      return true
    }
    if (typeof delta.thinking === "string") {
      emit({ type: "reasoning_delta", providerId: "claude-cli", sessionId: session.id, turnId, delta: delta.thinking })
      return true
    }
  }
  if (event.type === "content_block_start" && isRecord(event.content_block)) {
    const block = event.content_block
    if (block.type === "tool_use") {
      emit({
        type: "tool_call",
        providerId: "claude-cli",
        sessionId: session.id,
        turnId,
        id: typeof block.id === "string" ? block.id : randomUUID(),
        name: typeof block.name === "string" ? block.name : "tool",
        input: block.input,
      })
    }
  }
  return false
}

function extractClaudeAssistantText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return ""
  return message.content
    .map((block) => {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") return block.text
      return ""
    })
    .filter(Boolean)
    .join("")
}

async function startTurn(params: Record<string, unknown>) {
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : ""
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`Unknown session: ${sessionId}`)
  if (session.activeTurnId) throw new Error("A turn is already active for this session")
  const turnId = randomUUID()
  session.activeTurnId = turnId
  if (typeof params.model === "string") session.model = params.model
  if (typeof params.mode === "string") session.mode = params.mode as RuntimeMode
  const prompt = typeof params.prompt === "string" ? params.prompt : ""
  const providerSettings = isRecord(params.providerSettings) ? params.providerSettings as ProviderRuntimeSettings : undefined
  if (providerSettings) session.injectCodezalTools = providerSettings.injectCodezalTools !== false
  const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined
  void (async () => {
    try {
      if (session.providerId === "codex-cli") await runCodexTurn(session, turnId, prompt, providerSettings, systemPrompt)
      else await runClaudeTurn(session, turnId, prompt, providerSettings, systemPrompt)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({ type: "turn_failed", providerId: session.providerId, sessionId: session.id, turnId, error: message })
    } finally {
      session.activeTurnId = undefined
      session.activeAbort = undefined
    }
  })()
  return { turnId }
}

async function handleRequest(req: Record<string, unknown>) {
  const id = req.id as RpcId
  const method = String(req.method ?? "")
  const params = isRecord(req.params) ? req.params : {}
  switch (method) {
    case "initialize":
      return respond(id, { ok: true, runtime: { bun: process.versions.bun ?? null, node: process.versions.node ?? null } })
    case "provider/diagnose":
      return respond(id, await diagnoseProvider(params.providerId as ProviderId, isRecord(params.providerSettings) ? params.providerSettings : undefined))
    case "provider/listModels": {
      const providerId = params.providerId as ProviderId
      const settings = isRecord(params.providerSettings) ? params.providerSettings as ProviderRuntimeSettings : undefined
      return respond(id, { providerId, models: providerModels(providerId, settings) })
    }
    case "session/create": {
      const sessionId = randomUUID()
      const providerId = params.providerId as ProviderId
      sessions.set(sessionId, {
        id: sessionId,
        providerId,
        ownerSessionId: typeof params.ownerSessionId === "string" ? params.ownerSessionId : undefined,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        model: typeof params.model === "string" ? params.model : undefined,
        mode: (typeof params.mode === "string" ? params.mode : "ask") as RuntimeMode,
        injectCodezalTools: params.injectCodezalTools !== false,
        nativeHandle: typeof params.nativeHandle === "string" ? params.nativeHandle : undefined,
      })
      return respond(id, { sessionId })
    }
    case "session/resume": {
      const sessionId = randomUUID()
      const providerId = params.providerId as ProviderId
      sessions.set(sessionId, {
        id: sessionId,
        providerId,
        ownerSessionId: typeof params.ownerSessionId === "string" ? params.ownerSessionId : undefined,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        model: typeof params.model === "string" ? params.model : undefined,
        mode: (typeof params.mode === "string" ? params.mode : "ask") as RuntimeMode,
        injectCodezalTools: params.injectCodezalTools !== false,
        nativeHandle: typeof params.nativeHandle === "string" ? params.nativeHandle : undefined,
      })
      return respond(id, { sessionId })
    }
    case "turn/start":
      return respond(id, await startTurn(params))
    case "turn/interrupt": {
      const session = sessions.get(String(params.sessionId ?? ""))
      if (session?.providerId === "codex-cli" && session.codex && session.nativeHandle && session.activeTurnId) {
        session.codex.request("turn/interrupt", { threadId: session.nativeHandle, turnId: session.activeTurnId }).catch(() => undefined)
      }
      session?.activeAbort?.abort()
      if (session?.activeTurnId) emit({ type: "turn_canceled", providerId: session.providerId, sessionId: session.id, turnId: session.activeTurnId })
      return respond(id, { ok: true })
    }
    case "permission/resolve": {
      const requestId = String(params.requestId ?? "")
      const waiter = permissionWaiters.get(requestId)
      if (waiter) {
        permissionWaiters.delete(requestId)
        waiter.resolve(params.decision === "allow" ? "allow" : "deny")
      }
      return respond(id, { ok: true })
    }
    case "session/close": {
      const session = sessions.get(String(params.sessionId ?? ""))
      session?.codex?.dispose()
      if (session) sessions.delete(session.id)
      return respond(id, { ok: true })
    }
    case "runtime/shutdown":
      await shutdownRuntime()
      respond(id, { ok: true })
      process.exit(0)
      return
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

async function shutdownRuntime(): Promise<void> {
  for (const session of sessions.values()) session.codex?.dispose()
  sessions.clear()
  for (const waiter of hostWaiters.values()) {
    clearTimeout(waiter.timer)
    waiter.reject(new Error("Agent runtime shutting down"))
  }
  hostWaiters.clear()
  if (mcpServerPromise) {
    const current = await mcpServerPromise.catch(() => null)
    current?.server.close()
    mcpServerPromise = null
  }
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  inputBuffer += chunk
  let idx = inputBuffer.indexOf("\n")
  while (idx >= 0) {
    const raw = inputBuffer.slice(0, idx).trim()
    inputBuffer = inputBuffer.slice(idx + 1)
    if (raw) {
      void (async () => {
        let req: unknown
        try {
          req = JSON.parse(raw)
          if (!isRecord(req) || req.id == null) return
          if (handleHostResponse(req)) return
          if (typeof req.method !== "string") return
          await handleRequest(req)
        } catch (error) {
          if (isRecord(req) && req.id != null) rejectRequest(req.id as RpcId, error)
        }
      })()
    }
    idx = inputBuffer.indexOf("\n")
  }
})

process.on("SIGTERM", () => {
  void shutdownRuntime().finally(() => process.exit(0))
})
