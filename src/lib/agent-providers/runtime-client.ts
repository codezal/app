import { invoke } from "@tauri-apps/api/core"
import { join } from "@tauri-apps/api/path"
import { type Child } from "@tauri-apps/plugin-shell"
import { resolveProgram, shellInvocation, spawnProgram } from "@/lib/exec"
import { errorMessage } from "@/lib/errors"
import { callNativeMcpTool, listNativeMcpTools } from "./tool-proxy"
import type {
  AgentRuntimeDiagnostic,
  AgentRuntimeEvent,
  CliAgentModel,
  CliAgentProviderId,
  CliAgentProviderSettings,
} from "./types"

type RpcId = number
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

type RuntimeEnvelope =
  | { id: RpcId; result?: unknown; error?: { message?: string } }
  | { request: { id: RpcId; method?: string; params?: unknown } }
  | { event: AgentRuntimeEvent }

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, `'\\''`) + "'"
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, `""`)}"`
}

async function commandScript(command: string, args: string[]): Promise<string> {
  const { program } = await shellInvocation()
  const quote = program === "cmd" ? cmdQuote : shellQuote
  return [quote(command), ...args.map(quote)].join(" ")
}

async function resolveRuntimeInvocation(): Promise<{ command: string; args: string[]; label: string }> {
  const lspDir = await invoke<string | null>("lsp_resource_dir")
  const platform = await invoke<{ os: string; arch: string }>("lsp_platform")
  if (lspDir) {
    const bun = await join(lspDir, "bin", `bun${platform.os === "windows" ? ".exe" : ""}`)
    const entry = await join(lspDir, "agent-runtime", "index.js")
    const hasBun = await invoke<boolean>("lsp_path_exists", { path: bun }).catch(() => false)
    const hasEntry = await invoke<boolean>("lsp_path_exists", { path: entry }).catch(() => false)
    if (hasBun && hasEntry) {
      return { command: bun, args: [entry], label: "bundled-bun" }
    }
    if (hasEntry) {
      const node = await resolveProgram("node")
      if (node) return { command: node, args: [entry], label: "system-node" }
    }
  }
  throw new Error("Agent runtime bundle bulunamadı. `npm run build:agent-runtime` çalıştırın.")
}

export class AgentRuntimeClient {
  private child: Child | null = null
  private buffer = ""
  private nextId = 1
  private pending = new Map<RpcId, Pending>()
  private listeners = new Set<(event: AgentRuntimeEvent) => void>()
  private starting: Promise<void> | null = null

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async diagnose(
    providerId: CliAgentProviderId,
    providerSettings?: CliAgentProviderSettings,
  ): Promise<AgentRuntimeDiagnostic> {
    return await this.request<AgentRuntimeDiagnostic>("provider/diagnose", {
      providerId,
      providerSettings,
    })
  }

  async listModels(
    providerId: CliAgentProviderId,
    providerSettings?: CliAgentProviderSettings,
  ): Promise<CliAgentModel[]> {
    const result = await this.request<{ models?: Array<string | CliAgentModel> }>("provider/listModels", {
      providerId,
      providerSettings,
    })
    return normalizeModels(result.models)
  }

  async createSession(params: {
    providerId: CliAgentProviderId
    ownerSessionId: string
    cwd?: string
    model?: string
    mode: string
    injectCodezalTools?: boolean
    nativeHandle?: string
  }): Promise<{ sessionId: string }> {
    return await this.request<{ sessionId: string }>("session/create", params)
  }

  async resumeSession(params: {
    providerId: CliAgentProviderId
    ownerSessionId: string
    cwd?: string
    model?: string
    mode: string
    injectCodezalTools?: boolean
    nativeHandle: string
  }): Promise<{ sessionId: string }> {
    return await this.request<{ sessionId: string }>("session/resume", params)
  }

  async startTurn(params: {
    sessionId: string
    prompt: string
    model?: string
    mode: string
    providerSettings?: CliAgentProviderSettings
    systemPrompt?: string
  }): Promise<{ turnId: string }> {
    return await this.request<{ turnId: string }>("turn/start", params)
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request("turn/interrupt", { sessionId })
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request("session/close", { sessionId })
  }

  async resolvePermission(requestId: string, decision: "allow" | "deny"): Promise<void> {
    await this.request("permission/resolve", { requestId, decision })
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted()
    if (!this.child) throw new Error("Agent runtime başlatılamadı")
    const id = this.nextId++
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
    await this.child.write(`${JSON.stringify({ id, method, params })}\n`)
    return promise
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) return
    if (this.starting) return await this.starting
    this.starting = this.start()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async start(): Promise<void> {
    const invocation = await resolveRuntimeInvocation()
    const { program, flag } = await shellInvocation()
    const script = await commandScript(invocation.command, invocation.args)
    const cmd = await spawnProgram(program, [flag, script])
    cmd.stdout.on("data", (chunk: string) => this.onStdout(chunk))
    cmd.stderr.on("data", (chunk: string) => {
      const line = chunk.trimEnd()
      if (line) this.emit({ type: "stderr", line })
    })
    cmd.on("close", (payload: { code: number | null }) => {
      const err = new Error(`Agent runtime kapandı (exit ${payload.code ?? "?"})`)
      for (const pending of this.pending.values()) pending.reject(err)
      this.pending.clear()
      this.child = null
    })
    cmd.on("error", (err) => {
      const e = new Error(errorMessage(err))
      for (const pending of this.pending.values()) pending.reject(e)
      this.pending.clear()
      this.child = null
    })
    this.child = await cmd.spawn()
    await this.request("initialize", { client: "codezal" })
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
    let msg: RuntimeEnvelope
    try {
      msg = JSON.parse(raw) as RuntimeEnvelope
    } catch {
      return
    }
    if ("event" in msg) {
      this.emit(msg.event)
      return
    }
    if ("request" in msg) {
      await this.handleRuntimeRequest(msg.request)
      return
    }
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    if (msg.error) pending.reject(new Error(msg.error.message || "Agent runtime error"))
    else pending.resolve(msg.result)
  }

  private async handleRuntimeRequest(request: { id: RpcId; method?: string; params?: unknown }): Promise<void> {
    if (!this.child) return
    try {
      const result = await this.dispatchRuntimeRequest(String(request.method ?? ""), request.params)
      await this.child.write(`${JSON.stringify({ id: request.id, result })}\n`)
    } catch (error) {
      await this.child.write(`${JSON.stringify({ id: request.id, error: { message: errorMessage(error) } })}\n`)
    }
  }

  private async dispatchRuntimeRequest(method: string, params: unknown): Promise<unknown> {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {}
    const ownerSessionId = typeof p.ownerSessionId === "string" ? p.ownerSessionId : ""
    if (!ownerSessionId) throw new Error("Missing ownerSessionId for native Codezal tool request")
    const cwd = typeof p.cwd === "string" ? p.cwd : undefined
    switch (method) {
      case "codezalTools/list":
        return await listNativeMcpTools({ ownerSessionId, cwd })
      case "codezalTools/call":
        return await callNativeMcpTool({
          ownerSessionId,
          cwd,
          name: String(p.name ?? ""),
          arguments: p.arguments,
          toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
        })
      default:
        throw new Error(`Unknown runtime request: ${method}`)
    }
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

let runtimeClient: AgentRuntimeClient | null = null

export function getAgentRuntimeClient(): AgentRuntimeClient {
  runtimeClient ??= new AgentRuntimeClient()
  return runtimeClient
}

function normalizeModels(models: Array<string | CliAgentModel> | undefined): CliAgentModel[] {
  const seen = new Set<string>()
  const out: CliAgentModel[] = []
  for (const model of models ?? []) {
    const entry = typeof model === "string" ? { id: model, label: model } : model
    const id = entry.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...entry, id, source: entry.source ?? "runtime" })
  }
  return out
}
