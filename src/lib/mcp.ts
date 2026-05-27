// MCP HTTP/SSE/stdio client — settings.mcpServers'tan tanım okur, tool listele, ToolSet üretir.
// Stdio: Tauri plugin-shell bash -lc + Command.spawn üzerinden custom transport.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { jsonSchema, tool, type ToolSet } from "ai"
import { StdioClientTransport } from "./stdio-transport"

export type McpServerConfig = {
  // İnsan etiketi (tool isimleri prefix olarak kullanılır: <name>__<tool>)
  name: string
  // HTTP/SSE için URL, stdio için boş bırakılır
  url: string
  // HTTP/SSE: Authorization vb. header
  headers?: Record<string, string>
  // "http" (default, StreamableHTTP) | "sse" (legacy) | "stdio" (local subprocess)
  transport?: "http" | "sse" | "stdio"
  // stdio için: spawn edilecek komut + argümanlar + env + cwd
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // Yetersiz performans / hata için kapalı tutma
  enabled?: boolean
}

export type McpStatus = {
  name: string
  ok: boolean
  toolCount: number
  error?: string
}

type Cached = { client: Client; tools: ToolSet }
const CACHE = new Map<string, Cached>() // key = name + connection-id

function cacheKey(c: McpServerConfig): string {
  if (c.transport === "stdio") {
    return `${c.name}|stdio|${c.command}|${(c.args ?? []).join(" ")}`
  }
  return `${c.name}|${c.url}`
}

// Config → uygun Transport örneği döndür.
function buildTransport(config: McpServerConfig) {
  if (config.transport === "stdio") {
    if (!config.command) throw new Error(`MCP stdio: command boş (${config.name})`)
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    })
  }
  if (config.transport === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers ?? {} },
    })
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers ?? {} },
  })
}

export async function connectMcp(config: McpServerConfig): Promise<Cached> {
  const key = cacheKey(config)
  const hit = CACHE.get(key)
  if (hit) return hit

  const transport = buildTransport(config)

  const client = new Client(
    { name: "codezal", version: "0.1" },
    { capabilities: {} },
  )
  await client.connect(transport)

  // Tool listesi → AI SDK ToolSet
  const list = await client.listTools()
  const tools: ToolSet = {}
  for (const t of list.tools) {
    const prefixed = `${config.name}__${t.name}`
    tools[prefixed] = tool({
      description: t.description ?? `(MCP ${config.name})`,
      inputSchema: jsonSchema(t.inputSchema as Record<string, unknown>),
      execute: async (args: unknown) => {
        const res = await client.callTool({
          name: t.name,
          arguments: args as Record<string, unknown>,
        })
        // MCP content[] → tek string
        const content = (res.content ?? []) as Array<{ type: string; text?: string }>
        const parts = content
          .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
          .filter(Boolean)
        const text = parts.join("\n") || "(boş)"
        return res.isError ? `[MCP error] ${text}` : text
      },
    })
  }

  const cached = { client, tools }
  CACHE.set(key, cached)
  return cached
}

export async function buildMcpTools(servers: McpServerConfig[]): Promise<{
  tools: ToolSet
  statuses: McpStatus[]
}> {
  const tools: ToolSet = {}
  const statuses: McpStatus[] = []
  for (const s of servers) {
    const missingConn =
      s.transport === "stdio" ? !s.command : !s.url
    if (s.enabled === false || missingConn) {
      statuses.push({
        name: s.name,
        ok: false,
        toolCount: 0,
        error: s.enabled === false ? "kapalı" : "bağlantı boş",
      })
      continue
    }
    try {
      const { tools: t } = await connectMcp(s)
      Object.assign(tools, t)
      statuses.push({ name: s.name, ok: true, toolCount: Object.keys(t).length })
    } catch (e) {
      statuses.push({
        name: s.name,
        ok: false,
        toolCount: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { tools, statuses }
}

export async function disconnectAll(): Promise<void> {
  for (const [k, c] of CACHE) {
    try {
      await c.client.close()
    } catch {
      // sessiz geç
    }
    CACHE.delete(k)
  }
}

export async function listMcpStatus(servers: McpServerConfig[]): Promise<McpStatus[]> {
  const { statuses } = await buildMcpTools(servers)
  return statuses
}
