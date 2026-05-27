// User/workspace tanımlı slash komutları — .codezal/commands/*.md dosyalarından okur.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { parseCommandFile } from "./parse"
import type { SlashCommand, SlashScope } from "./types"

export async function readWorkspaceCommands(
  workspace: string | undefined,
): Promise<SlashCommand[]> {
  if (!workspace) return []
  const root = workspace.replace(/[\\/]+$/, "") + "/.codezal/commands"
  return readCommandsDir(root, "project")
}

export async function readUserCommands(): Promise<SlashCommand[]> {
  try {
    const home = await homeDir()
    const root = home.replace(/[\\/]+$/, "") + "/.codezal/commands"
    return readCommandsDir(root, "global")
  } catch {
    return []
  }
}

export async function readCommandsDir(
  root: string,
  scope: SlashScope,
): Promise<SlashCommand[]> {
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
    if (!e.name.endsWith(".md")) continue
    const path = root + "/" + e.name
    try {
      const raw = await readTextFile(path)
      const parsed = parseCommandFile(raw, e.name.replace(/\.md$/, ""))
      out.push({
        name: parsed.name,
        description: parsed.description,
        scope,
        template: parsed.template,
        needsArg: parsed.template?.includes("$ARG") || parsed.template?.includes("$ARGS"),
        path,
      })
    } catch {
      // sessiz geç
    }
  }
  return out
}
