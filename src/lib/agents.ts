// Agent tanımları — .codezal/agents/<name>.md (workspace) ve ~/.codezal/agents/<name>.md (global).
// Frontmatter: name, description, model?, provider?, tools?, max_steps?
// Body: agent'a verilecek system prompt.
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type { ProviderId } from "./providers"

export type AgentScope = "project" | "global"

// Subagent yetki politikası — frontmatter alanları:
//   tools: [list_dir, read_file, ...]        → whitelist
//   deny_tools: [bash, write_file]           → blacklist (whitelist'i override eder)
//   bash_allow: ["git ", "npm test", ...]    → bash komutu prefix listesi (varsa, sadece eşleşenler çalışır)
//   bash_deny: ["rm -rf", "curl ", ...]      → bash prefix listesi (her zaman reddedilir)
//   approval_required: [bash, edit_file]     → bu tool'lar her zaman kullanıcı onayı ister
//   plan_mode: true                          → subagent plan modunda başlar (write/edit/bash/patch reddedilir)
export type SubagentPolicy = {
  tools?: string[]
  denyTools?: string[]
  bashAllow?: string[]
  bashDeny?: string[]
  approvalRequired?: string[]
  planMode?: boolean
}

export type AgentDef = {
  name: string
  description: string
  // Opsiyonel — yoksa parent session'ın provider/model'i kullanılır
  provider?: ProviderId
  model?: string
  // Whitelist tool isimleri — yoksa ana setin tümü (AgentDef.tools ile SubagentPolicy.tools aynı)
  tools?: string[]
  maxSteps?: number
  // Granular permissions
  policy: SubagentPolicy
  path: string
  scope: AgentScope
  systemPrompt: string
}

const MAX_BODY = 32_000

export async function readWorkspaceAgents(workspace: string | undefined): Promise<AgentDef[]> {
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

async function readAgentsDir(root: string, scope: AgentScope): Promise<AgentDef[]> {
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
      // sessiz geç
    }
  }
  return out
}

function parseAgentFile(raw: string, fallbackName: string): Omit<AgentDef, "path" | "scope"> {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return {
      name: fallbackName,
      description: "",
      policy: {},
      systemPrompt: raw.slice(0, MAX_BODY),
    }
  }
  const fm = m[1]
  const body = m[2].slice(0, MAX_BODY)
  const obj: Record<string, unknown> = {}
  for (const line of fm.split("\n")) {
    const km = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/)
    if (!km) continue
    const key = km[1].trim()
    const val = km[2].trim()
    if (val.startsWith("[") && val.endsWith("]")) {
      obj[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    } else if (/^\d+$/.test(val)) {
      obj[key] = parseInt(val, 10)
    } else if (val === "true" || val === "false") {
      obj[key] = val === "true"
    } else {
      obj[key] = val.replace(/^["']|["']$/g, "")
    }
  }
  const tools = Array.isArray(obj.tools) ? (obj.tools as string[]) : undefined
  const policy: SubagentPolicy = {
    tools,
    denyTools: Array.isArray(obj.deny_tools) ? (obj.deny_tools as string[]) : undefined,
    bashAllow: Array.isArray(obj.bash_allow) ? (obj.bash_allow as string[]) : undefined,
    bashDeny: Array.isArray(obj.bash_deny) ? (obj.bash_deny as string[]) : undefined,
    approvalRequired: Array.isArray(obj.approval_required)
      ? (obj.approval_required as string[])
      : undefined,
    planMode: typeof obj.plan_mode === "boolean" ? (obj.plan_mode as boolean) : undefined,
  }
  return {
    name: String(obj.name ?? fallbackName),
    description: String(obj.description ?? ""),
    provider: obj.provider as ProviderId | undefined,
    model: obj.model as string | undefined,
    tools,
    maxSteps: typeof obj.max_steps === "number" ? (obj.max_steps as number) : undefined,
    policy,
    systemPrompt: body,
  }
}

// Subagent için tool çağrısı policy'ye uyuyor mu?
// Dönüş: { allowed, reason?, requiresApproval } — reason "..." → reddet.
export function checkSubagentPolicy(
  policy: SubagentPolicy,
  toolName: string,
  input: unknown,
): { allowed: boolean; reason?: string; requiresApproval: boolean } {
  // Plan mode → mutasyon tool'larını reddet
  if (policy.planMode) {
    const blocked = new Set(["write_file", "edit_file", "bash", "apply_patch"])
    if (blocked.has(toolName)) {
      return {
        allowed: false,
        reason: `Subagent plan modunda — '${toolName}' kullanılamaz`,
        requiresApproval: false,
      }
    }
  }
  // Deny list (whitelist'i override eder)
  if (policy.denyTools?.includes(toolName)) {
    return {
      allowed: false,
      reason: `'${toolName}' subagent için kara listede`,
      requiresApproval: false,
    }
  }
  // Whitelist varsa ve tool whitelist'te değilse reddet
  if (policy.tools && policy.tools.length > 0 && !policy.tools.includes(toolName)) {
    return {
      allowed: false,
      reason: `'${toolName}' subagent whitelist'inde değil`,
      requiresApproval: false,
    }
  }
  // Bash policy — komut prefix kontrolü
  if (toolName === "bash") {
    const cmd = String((input as { command?: string }).command ?? "")
    if (policy.bashDeny && policy.bashDeny.some((p) => cmd.startsWith(p))) {
      return {
        allowed: false,
        reason: `Bash komutu kara listede ('${cmd.slice(0, 50)}...')`,
        requiresApproval: false,
      }
    }
    if (policy.bashAllow && policy.bashAllow.length > 0) {
      if (!policy.bashAllow.some((p) => cmd.startsWith(p))) {
        return {
          allowed: false,
          reason: `Bash komutu beyaz liste prefix'lerinden hiçbiriyle başlamıyor`,
          requiresApproval: false,
        }
      }
    }
  }
  // Approval required listesindeyse onay zorunlu
  const requiresApproval = policy.approvalRequired?.includes(toolName) ?? false
  return { allowed: true, requiresApproval }
}

// System prompt'a iliştirilecek katalog — isim+açıklama. Tam body spawn ile yüklenir.
export function buildAgentsCatalog(agents: AgentDef[]): string {
  if (agents.length === 0) return ""
  const lines = ["# Mevcut Agents (delegate edilebilir)"]
  lines.push(
    "Karmaşık alt görevleri `spawn_agent` tool'u ile bir agent'a devret. Agent kendi tool döngüsünü çalıştırır ve final özeti döner.",
  )
  lines.push("")
  for (const a of agents) {
    lines.push(`- **${a.name}** (${a.scope}): ${a.description}`)
  }
  return lines.join("\n")
}

export async function findAgent(
  workspace: string | undefined,
  name: string,
): Promise<AgentDef | null> {
  const [proj, user] = await Promise.all([
    readWorkspaceAgents(workspace),
    readUserAgents(),
  ])
  return [...proj, ...user].find((a) => a.name === name) ?? null
}
