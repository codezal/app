import { asSchema, type JSONSchema7, type ToolSet } from "ai"
import { buildAllTools } from "@/lib/tools"
import { resolveEffectiveSettings } from "@/lib/config"
import { errorMessage } from "@/lib/errors"

export type NativeMcpToolDefinition = {
  name: string
  description?: string
  inputSchema: JSONSchema7
}

export type NativeMcpToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent?: unknown
  isError?: boolean
}

type ToolLike = {
  description?: string
  inputSchema?: unknown
  execute?: (input: unknown, options: unknown) => unknown
}

const NATIVE_MCP_TOOL_NAMES = new Set([
  "list_dir",
  "read_file",
  "read_summary",
  "grep",
  "glob",
  "code_query",
  "code_search",
  "code_callers",
  "code_callees",
  "code_trace",
  "code_impact",
  "code_context",
  "repo_overview",
  "webfetch",
  "websearch",
  "question",
  "notify",
  "todo_write",
  "propose_plan",
  "propose_build",
  "bash",
  "bash_status",
  "apply_patch",
  "list_worktrees",
  "create_worktree",
  "remove_worktree",
  "index_docs",
  "load_skill",
  "remember",
  "save_method",
  "delegate_agents",
])

function fallbackSchema(): JSONSchema7 {
  return { type: "object", additionalProperties: true }
}

async function toJsonSchema(schema: unknown): Promise<JSONSchema7> {
  if (!schema) return fallbackSchema()
  try {
    const normalized = asSchema(schema as Parameters<typeof asSchema>[0])
    const json = await Promise.resolve(normalized.jsonSchema)
    return json && typeof json === "object" ? json : fallbackSchema()
  } catch {
    return fallbackSchema()
  }
}

function toolRecord(tools: ToolSet): Record<string, ToolLike> {
  return tools as Record<string, ToolLike>
}

async function buildNativeToolSet(ownerSessionId: string, cwd?: string): Promise<Record<string, ToolLike>> {
  const effective = await resolveEffectiveSettings(cwd)
  const tools = await buildAllTools(cwd, effective.mcpServers ?? [], ownerSessionId, undefined, 160_000)
  return toolRecord(tools)
}

export async function listNativeMcpTools(params: {
  ownerSessionId: string
  cwd?: string
}): Promise<{ tools: NativeMcpToolDefinition[] }> {
  const tools = await buildNativeToolSet(params.ownerSessionId, params.cwd)
  const definitions: NativeMcpToolDefinition[] = []
  for (const name of Object.keys(tools).sort()) {
    if (!NATIVE_MCP_TOOL_NAMES.has(name)) continue
    const tool = tools[name]
    definitions.push({
      name,
      description: tool.description,
      inputSchema: await toJsonSchema(tool.inputSchema),
    })
  }
  return { tools: definitions }
}

export async function callNativeMcpTool(params: {
  ownerSessionId: string
  cwd?: string
  name: string
  arguments?: unknown
  toolCallId?: string
}): Promise<NativeMcpToolResult> {
  const tools = await buildNativeToolSet(params.ownerSessionId, params.cwd)
  const tool = tools[params.name]
  if (!NATIVE_MCP_TOOL_NAMES.has(params.name) || !tool?.execute) {
    return {
      content: [{ type: "text", text: `Unknown or unavailable Codezal tool: ${params.name}` }],
      isError: true,
    }
  }
  try {
    const result = tool.execute(params.arguments ?? {}, {
      toolCallId: params.toolCallId ?? `native-mcp-${params.name}`,
    })
    const value = await collectToolResult(await Promise.resolve(result))
    return {
      content: [{ type: "text", text: stringifyToolResult(value) }],
      structuredContent: isStructured(value) ? value : undefined,
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: errorMessage(error) }],
      isError: true,
    }
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof value === "object" && Symbol.asyncIterator in value
}

async function collectToolResult(value: unknown): Promise<unknown> {
  if (!isAsyncIterable(value)) return value
  const chunks: unknown[] = []
  for await (const chunk of value) chunks.push(chunk)
  return chunks
}

function isStructured(value: unknown): boolean {
  return value != null && typeof value === "object"
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
