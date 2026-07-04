//
import { type Child } from "@tauri-apps/plugin-shell"
import { invoke } from "@tauri-apps/api/core"
import { spawnProgram, shellInvocation } from "@/lib/exec"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { errorMessage } from "@/lib/errors"

export type StdioOptions = {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

// Terminate the process subtree rooted at `pid` via Rust proc_kill_tree
// (cross-platform: unix ps-walk / win taskkill /T). The MCP server is exec'd in
// place of bash, so child.kill() alone can leave grandchildren orphaned — the
// tree-kill reaps them too. Best-effort: any failure (already dead) is swallowed.
async function killProcessTree(pid: number): Promise<void> {
  try {
    await invoke("proc_kill_tree", { pid })
  } catch (e) {
    console.warn(`[mcp stdio] kill tree failed:`, errorMessage(e))
  }
}

// command + args + env → bash -lc tek string.
// env: export FOO=bar; ...
// cwd: cd /path && ...
// command + her arg shell-quoted.
function buildWrappedCommand(opts: StdioOptions): string {
  const parts: string[] = []
  if (opts.cwd) parts.push(`cd ${shellQuote(opts.cwd)}`)
  parts.push(`export CODEZAL=1`)
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (!VALID_ENV_KEY.test(k)) continue
      parts.push(`export ${k}=${shellQuote(v)}`)
    }
  }
  const argStr = (opts.args ?? []).map(shellQuote).join(" ")
  parts.push(`exec ${shellQuote(opts.command)} ${argStr}`.trim())
  return parts.join("; ")
}

export class StdioClientTransport implements Transport {
  private child: Child | null = null
  private buffer = ""
  private started = false
  private closing = false
  private opts: StdioOptions

  onmessage?: (message: JSONRPCMessage) => void
  onerror?: (error: Error) => void
  onclose?: () => void

  constructor(opts: StdioOptions) {
    this.opts = opts
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("StdioClientTransport zaten başlatıldı")
    this.started = true

    const wrapped = buildWrappedCommand(this.opts)
    // Shell launcher (bash -lc / Windows'ta Git-Bash veya cmd /c). MCP server komutu
    // arbitrary (whitelist'lenemez) → shell exec eder. wrapped bash syntax (cd/export/exec).
    const { program, flag } = await shellInvocation()
    const cmd = await spawnProgram(program, [flag, wrapped])

    cmd.stdout.on("data", (line: string) => {
      this.buffer += line
      this.flushBuffer()
    })
    cmd.stderr.on("data", (line: string) => {
      if (line.trim()) console.warn(`[mcp stdio ${this.opts.command}] stderr:`, line)
    })
    cmd.on("error", (err: string) => {
      this.onerror?.(new Error(`Spawn hatası: ${err}`))
    })
    cmd.on("close", (payload: { code: number | null; signal: number | null }) => {
      if (this.closing) return
      this.closing = true
      const reason =
        payload.code != null
          ? `exit ${payload.code}`
          : payload.signal != null
            ? `signal ${payload.signal}`
            : "kapandı"
      if (payload.code && payload.code !== 0) {
        this.onerror?.(new Error(`MCP server beklenmedik ${reason}`))
      }
      this.onclose?.()
    })

    try {
      this.child = await cmd.spawn()
    } catch (e) {
      this.started = false
      throw new Error(
        `MCP stdio spawn başarısız: ${errorMessage(e)}`,
        { cause: e },
      )
    }
  }

  private flushBuffer(): void {
    let idx: number
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const raw = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!raw) continue
      try {
        const msg = JSON.parse(raw) as JSONRPCMessage
        this.onmessage?.(msg)
      } catch (e) {
        console.warn(
          `[mcp stdio ${this.opts.command}] parse hatası:`,
          errorMessage(e),
          `raw=${raw.slice(0, 200)}`,
        )
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child) throw new Error("MCP stdio bağlantısı açık değil")
    const line = JSON.stringify(message) + "\n"
    await this.child.write(line)
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.child) {
      const pid = this.child.pid
      if (typeof pid === "number") await killProcessTree(pid)
      try {
        await this.child.kill()
      } catch (e) {
        console.warn(
          `[mcp stdio ${this.opts.command}] kill başarısız:`,
          errorMessage(e),
        )
      }
      this.child = null
    }
    this.onclose?.()
  }
}
