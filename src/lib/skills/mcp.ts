//
import { listMcpResources, readMcpResource } from "../mcp"
import { parseSkillFile } from "./parse"
import type { Skill } from "./types"

const SKILL_URI_PREFIX = "skill://"

let mcpSkills: Skill[] = []

function notify(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codezal:skills-changed"))
  }
}

export function listMcpSkills(): Skill[] {
  return [...mcpSkills]
}

export function _clearMcpSkills(): void {
  if (mcpSkills.length === 0) return
  mcpSkills = []
  notify()
}

export function isSkillUri(uri: string): boolean {
  return uri.toLowerCase().startsWith(SKILL_URI_PREFIX)
}

export function extractText(
  result: Awaited<ReturnType<typeof readMcpResource>>,
): string | null {
  const contents = (result as { contents?: Array<{ text?: unknown }> }).contents
  if (!Array.isArray(contents)) return null
  for (const c of contents) {
    if (typeof c.text === "string") return c.text
  }
  return null
}

export function mcpResourceToSkill(
  serverName: string,
  resource: { uri: string; name?: string; description?: string },
  rawText: string,
): Skill {
  const fallback = resource.name || resource.uri.slice(SKILL_URI_PREFIX.length) || resource.uri
  const parsed = parseSkillFile(rawText, fallback)
  return {
    name: parsed.name,
    description: parsed.description || resource.description || "",
    triggers: parsed.triggers,
    body: parsed.body,
    path: resource.uri, // lokal dosya yok — kaynak URI
    dir: "",
    scope: "mcp",
    origin: "mcp",
    bytes: parsed.body.length,
    mcpServer: serverName,
  }
}

export async function refreshMcpSkills(
  servers: Parameters<typeof listMcpResources>[0][],
): Promise<void> {
  const collected: Skill[] = []
  for (const config of servers) {
    let resources: Awaited<ReturnType<typeof listMcpResources>>
    try {
      resources = await listMcpResources(config)
    } catch {
      continue
    }
    for (const r of resources.filter((x) => isSkillUri(x.uri))) {
      try {
        const text = extractText(await readMcpResource(config, r.uri))
        if (!text) continue
        collected.push(mcpResourceToSkill(config.name, r, text))
      } catch {
        // Intentionally ignored.
      }
    }
  }
  mcpSkills = collected
  notify()
}
