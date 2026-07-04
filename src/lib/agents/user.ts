// User/workspace agent okuyucusu — .codezal/agents/*.md tarar.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { parseAgentFile } from "./parse"
import type { AgentDef, AgentScope } from "./types"

export async function readWorkspaceAgents(
  workspace: string | undefined,
): Promise<AgentDef[]> {
  if (!workspace) return []
  const root = workspace.replace(/[\\/]+$/, "") + "/.codezal/agents"
  return readAgentsDir(root, "project")
}

export async function readUserAgents(): Promise<AgentDef[]> {
  try {
    const home = await homeDir()
    const root = home.replace(/[\\/]+$/, "") + "/.codezal/agents"
    return readAgentsDir(root, "global")
  } catch {
    return []
  }
}

export async function readAgentsDir(
  root: string,
  scope: AgentScope,
): Promise<AgentDef[]> {
  try {
    if (!(await exists(root))) return []
  } catch {
    return []
  }
  let entries
  try {
    entries = await readDir(root)
  } catch {
    return []
  }
  const out: AgentDef[] = []
  for (const e of entries) {
    if (!e.name.endsWith(".md")) continue
    const path = root + "/" + e.name
    try {
      const raw = await readTextFile(path)
      const parsed = parseAgentFile(raw, e.name.replace(/\.md$/, ""))
      out.push({ ...parsed, path, scope })
    } catch {
      // Intentionally ignored.
    }
  }
  return out
}
