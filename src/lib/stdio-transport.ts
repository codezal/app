// MCP stdio transport — Tauri plugin-shell `Command.spawn()` üzerinden.
// MCP server'ı bash -lc ile spawn et, stdin'e JSON-RPC mesajları \n ile gönder,
// stdout'tan satır satır oku, JSON parse et, onmessage çağır.
//
// Uyarı: capabilities/default.json zaten `shell:allow-spawn` ve `shell:allow-stdin-write`
// için `bash -lc` izni veriyor — ekstra Rust kodu gerekmez.
import { Command, type Child } from "@tauri-apps/plugin-shell"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

export type StdioOptions = {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

// Shell-escape tek tırnak.
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// command + args + env → bash -lc tek string.
// env: export FOO=bar; ...
// cwd: cd /path && ...
// command + her arg shell-quoted.
function buildWrappedCommand(opts: StdioOptions): string {
  const parts: string[] = []
  if (opts.cwd) parts.push(`cd ${shellQuote(opts.cwd)}`)
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
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

  onmessage?: (message: JSONRPCMessage) => void
  onerror?: (error: Error) => void
  onclose?: () => void

  constructor(private opts: StdioOptions) {}

  async start(): Promise<void> {
    if (this.started) throw new Error("StdioClientTransport zaten başlatıldı")
    this.started = true

    const wrapped = buildWrappedCommand(this.opts)
    const cmd = Command.create("bash", ["-lc", wrapped])

    cmd.stdout.on("data", (line: string) => {
      // plugin-shell line bazlı emit ediyor ama her zaman tam line garanti değil — buffer'la.
      this.buffer += line
      this.flushBuffer()
    })
    cmd.stderr.on("data", (line: string) => {
      // stderr'i error event'ine çevirmiyoruz — gürültü olur. Sadece logla.
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
        `MCP stdio spawn başarısız: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      )
    }
  }

  // Buffer'da kalan tam satırları parse et + onmessage çağır.
  // Son satır tamamlanmamış olabilir → buffer'da bırak.
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
        // Parse edilemeyen satır → muhtemelen debug/log. Sessiz at.
        console.warn(
          `[mcp stdio ${this.opts.command}] parse hatası:`,
          e instanceof Error ? e.message : String(e),
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
      try {
        await this.child.kill()
      } catch (e) {
        // Çoktan ölmüş olabilir — sessiz geç.
        console.warn(
          `[mcp stdio ${this.opts.command}] kill başarısız:`,
          e instanceof Error ? e.message : String(e),
        )
      }
      this.child = null
    }
    this.onclose?.()
  }
}
