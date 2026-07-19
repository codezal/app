// SKILL.md frontmatter parser.
import { parseFrontmatter } from "./frontmatter"
import type { Skill } from "./types"

const MAX_BODY = 32_000

export function parseSkillFile(
  raw: string,
  fallbackName: string,
): {
  name: string
  description: string
  triggers?: string[]
  body: string
} {
  const { data, body } = parseFrontmatter(raw)
  const triggers = Array.isArray(data.triggers)
    ? (data.triggers as unknown[]).map(String)
    : undefined
  return {
    name: String(data.name ?? fallbackName),
    description: String(data.description ?? ""),
    triggers,
    body: body.slice(0, MAX_BODY),
  }
}

export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return ""
  const lines = ["# Available Skills (on-demand)"]
  lines.push(
    "Use progressive disclosure: choose skills from the metadata below, then call `load_skill` before following a skill's workflow.",
  )
  lines.push(
    "Load a skill when the user names it explicitly or when the task clearly matches its description or triggers. Load only relevant skills.",
  )
  lines.push("")
  for (const s of skills) {
    const trig = s.triggers?.length ? ` · trig: ${s.triggers.join(", ")}` : ""
    const tag = s.pluginId
      ? ` [plugin:${s.pluginId}]`
      : s.mcpServer
        ? ` [mcp:${s.mcpServer}]`
        : s.origin !== "codezal"
          ? ` [${s.origin}]`
          : ""
    lines.push(
      `- **${s.name}** (${s.scope}${tag}): ${s.description}${trig} · path: ${s.path}`,
    )
  }
  return lines.join("\n")
}
