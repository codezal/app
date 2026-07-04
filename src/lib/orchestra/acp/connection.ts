//
import { type Child } from "@tauri-apps/plugin-shell"
import { invoke } from "@tauri-apps/api/core"
import { spawnProgram, shellInvocation } from "@/lib/exec"
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./protocol"
import { errorMessage } from "@/lib/errors"

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

const MAX_LINE_BUFFER = 16 * 1024 * 1024 // 16 MB

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

// unix ps-walk / win taskkill /T). Best-effort.
async function killProcessTree(pid: number): Promise<void> {
  try {
    await invoke("proc_kill_tree", { pid })
  } catch (e) {
    console.warn(`[acp] kill tree failed:`, errorMessage(e))
  }
}

export type RequestHandler = (params: unknown) => Promise<unknown>
export type NotificationHandler = (params: unknown) => void

export type AcpConnectionOptions = {
  command: string
  cwd?: string
  env?: Record<string, string>
  onStderr?: (line: string) => void
  onClose?: (code: number | null) => void
}

export class AcpConnection {
  private child: Child | null = null
  private buffer = ""
  private nextId = 1
  private pending = new Map<
    JsonRpcId,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private requestHandlers = new Map<string, RequestHandler>()
  private notificationHandlers = new Map<string, NotificationHandler>()
  private closing = false
  private opts: AcpConnectionOptions

  constructor(opts: AcpConnectionOptions) {
    this.opts = opts
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler)
  }
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler)
  }

  async start(): Promise<void> {
    const parts: string[] = []
    if (this.opts.cwd) parts.push(`cd ${shellQuote(this.opts.cwd)}`)
    if (this.opts.env) {
      for (const [k, v] of Object.entries(this.opts.env)) {
        if (!VALID_ENV_KEY.test(k)) continue
        parts.push(`export ${k}=${shellQuote(v)}`)
      }
    }
    parts.push(this.opts.command)
    const wrapped = parts.join("; ")

    const { program, flag } = await shellInvocation()
    const cmd = await spawnProgram(program, [flag, wrapped])

    cmd.stdout.on("data", (line: string) => {
      this.buffer += line
      this.flush()
      if (this.buffer.length > MAX_LINE_BUFFER) {
        const err = new Error(`ACP satır buffer'ı ${MAX_LINE_BUFFER} byte aştı — bağlantı kapatıldı`)
        for (const p of this.pending.values()) p.reject(err)
        this.pending.clear()
        this.buffer = ""
        void this.close()
      }
    })
    cmd.stderr.on("data", (line: string) => {
      if (line.trim()) this.opts.onStderr?.(line)
    })
    cmd.on("close", (payload: { code: number | null }) => {
      if (this.closing) return
      this.closing = true
      const err = new Error(`ACP süreci kapandı (exit ${payload.code ?? "?"})`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.opts.onClose?.(payload.code)
    })

    this.child = await cmd.spawn()
  }

  private flush(): void {
    let idx: number
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const raw = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!raw) continue
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(raw) as JsonRpcMessage
      } catch {
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    const anyMsg = msg as JsonRpcRequest & JsonRpcResponse
    if (typeof anyMsg.method === "string") {
      const { method, params, id } = anyMsg
      if (id !== undefined && id !== null) {
        const handler = this.requestHandlers.get(method)
        if (!handler) {
          void this.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          })
          return
        }
        void handler(params).then(
          (result) => this.send({ jsonrpc: "2.0", id, result }),
          (e: unknown) =>
            this.send({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: errorMessage(e),
              },
            }),
        )
      } else {
        this.notificationHandlers.get(method)?.(params)
      }
      return
    }
    if (anyMsg.id !== undefined && anyMsg.id !== null) {
      const p = this.pending.get(anyMsg.id)
      if (!p) return
      this.pending.delete(anyMsg.id)
      if (anyMsg.error) p.reject(new Error(anyMsg.error.message || "ACP error"))
      else p.resolve(anyMsg.result)
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    await this.send({ jsonrpc: "2.0", id, method, params })
    return promise
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, params })
  }

  private async send(msg: JsonRpcMessage): Promise<void> {
    if (!this.child) throw new Error("ACP bağlantısı açık değil")
    await this.child.write(JSON.stringify(msg) + "\n")
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const err = new Error("ACP bağlantısı kapatıldı")
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    if (this.child) {
      const pid = this.child.pid
      if (typeof pid === "number") await killProcessTree(pid)
      try {
        await this.child.kill()
      } catch (e) {
        console.warn(`[acp] kill failed:`, errorMessage(e))
      }
      this.child = null
    }
  }
}
