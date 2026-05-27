// Slash komutları — Composer'a `/` ile yazılır, picker açar.
// Built-in: /clear /branch /model /agent /skill /workspace /help
// User-defined: .codezal/commands/<name>.md (frontmatter: name, description) + body prompt template.
//   Template: $ARG yer tutucusu var ise kullanıcının `/cmd <args>` sonrası girdisi yerleşir.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

export type SlashScope = "builtin" | "project" | "global"

export type SlashCommand = {
  name: string
  description: string
  scope: SlashScope
  // Promp template (user-defined) ya da action key (builtin)
  template?: string
  action?:
    | "clear"
    | "branch"
    | "model"
    | "agent"
    | "skill"
    | "workspace"
    | "help"
    | "stop"
    | "search"
    | "routines"
    | "settings"
  // builtin: alt-menü açar mı (örn /model → model picker)
  needsArg?: boolean
  path?: string
}

const BUILTINS: SlashCommand[] = [
  { name: "clear", description: "Aktif sohbet mesajlarını temizle", scope: "builtin", action: "clear" },
  { name: "branch", description: "Bu sohbetten çatal (yeni session)", scope: "builtin", action: "branch" },
  { name: "model", description: "Model değiştir (palette aç)", scope: "builtin", action: "model" },
  { name: "agent", description: "Bir ajan ile sohbet et", scope: "builtin", action: "agent", needsArg: true },
  { name: "skill", description: "Skill yükle ve devam et", scope: "builtin", action: "skill", needsArg: true },
  { name: "workspace", description: "Workspace klasörü seç", scope: "builtin", action: "workspace" },
  { name: "search", description: "Workspace içinde ara", scope: "builtin", action: "search" },
  { name: "routines", description: "Rutinleri aç", scope: "builtin", action: "routines" },
  { name: "settings", description: "Ayarları aç", scope: "builtin", action: "settings" },
  { name: "stop", description: "Devam eden stream'i durdur", scope: "builtin", action: "stop" },
  { name: "help", description: "Tüm komutları göster", scope: "builtin", action: "help" },
]

const MAX_BODY = 8_000

export async function readWorkspaceCommands(workspace: string | undefined): Promise<SlashCommand[]> {
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

async function readCommandsDir(root: string, scope: SlashScope): Promise<SlashCommand[]> {
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

function parseCommandFile(raw: string, fallbackName: string): {
  name: string
  description: string
  template: string
} {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return { name: fallbackName, description: "", template: raw.slice(0, MAX_BODY) }
  }
  const obj: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/)
    if (!km) continue
    obj[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, "")
  }
  return {
    name: obj.name ?? fallbackName,
    description: obj.description ?? "",
    template: m[2].slice(0, MAX_BODY),
  }
}

export async function listAllCommands(workspace: string | undefined): Promise<SlashCommand[]> {
  const [proj, user] = await Promise.all([
    readWorkspaceCommands(workspace),
    readUserCommands(),
  ])
  return [...BUILTINS, ...proj, ...user]
}

// `/cmd args…` parse — komut adı + arg
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null
  const trimmed = text.slice(1)
  const sp = trimmed.indexOf(" ")
  if (sp === -1) return { name: trimmed, args: "" }
  return { name: trimmed.slice(0, sp), args: trimmed.slice(sp + 1).trim() }
}

// Template'e arg yerleştir. $ARG / $ARGS / {{arg}} desteklenir.
export function renderTemplate(template: string, args: string): string {
  return template
    .replaceAll("$ARGS", args)
    .replaceAll("$ARG", args)
    .replaceAll("{{arg}}", args)
    .replaceAll("{{args}}", args)
}

export { BUILTINS }
