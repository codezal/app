import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { parseMeta } from "../orchestra/workflow/meta"
import type { SlashCommand, SlashScope } from "./types"

function workflowsRoot(base: string): string {
  return base.replace(/[\\/]+$/, "") + "/.codezal/workflows"
}

async function readWorkflowsDir(root: string, scope: SlashScope): Promise<SlashCommand[]> {
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
  const out: SlashCommand[] = []
  for (const e of entries) {
    if (!e.name.endsWith(".js")) continue
    const path = root + "/" + e.name
    const fallbackName = e.name.replace(/\.js$/, "")
    try {
      const raw = await readTextFile(path)
      let name = fallbackName
      let description = "Workflow"
      try {
        const meta = parseMeta(raw)
        name = meta.name || fallbackName
        description = meta.description || description
      } catch {
        // Intentionally ignored.
      }
      out.push({
        name,
        description,
        scope,
        action: "workflow-run",
        needsArg: true,
        path,
      })
    } catch {
      // Intentionally ignored.
    }
  }
  return out
}

export async function readWorkspaceWorkflows(workspace: string | undefined): Promise<SlashCommand[]> {
  if (!workspace) return []
  return readWorkflowsDir(workflowsRoot(workspace), "workflow")
}

export async function readUserWorkflows(): Promise<SlashCommand[]> {
  try {
    const home = await homeDir()
    return readWorkflowsDir(workflowsRoot(home), "workflow")
  } catch {
    return []
  }
}

export async function loadWorkflowScript(
  nameOrRef: string | { scriptPath: string },
  workspace: string | undefined,
): Promise<string> {
  if (typeof nameOrRef === "object") {
    return readTextFile(nameOrRef.scriptPath)
  }
  const roots = [workspace ? workflowsRoot(workspace) : null]
  try {
    roots.push(workflowsRoot(await homeDir()))
  } catch {
    // Intentionally ignored.
  }
  for (const root of roots) {
    if (!root) continue
    const path = `${root}/${nameOrRef}.js`
    try {
      if (await exists(path)) return await readTextFile(path)
    } catch {
      // Intentionally ignored.
    }
  }
  throw new Error(`Kayıtlı workflow bulunamadı: ${nameOrRef}`)
}
