import type { AgentDef, SubagentPolicy } from "./types"
import type { ProviderId } from "../providers/types"

const MAX_BODY = 32_000

export function parseAgentFile(
  raw: string,
  fallbackName: string,
): Omit<AgentDef, "path" | "scope"> {
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

export function checkSubagentPolicy(
  policy: SubagentPolicy,
  toolName: string,
  input: unknown,
): { allowed: boolean; reason?: string; requiresApproval: boolean } {
  if (policy.planMode) {
    const blocked = new Set(["write_file", "edit_file", "bash", "apply_patch"])
    if (blocked.has(toolName)) {
      return {
        allowed: false,
        reason: `Subagent is in plan mode; '${toolName}' cannot be used`,
        requiresApproval: false,
      }
    }
  }
  if (policy.denyTools?.includes(toolName)) {
    return {
      allowed: false,
      reason: `'${toolName}' is denylisted for this subagent`,
      requiresApproval: false,
    }
  }
  if (policy.tools && policy.tools.length > 0 && !policy.tools.includes(toolName)) {
    return {
      allowed: false,
      reason: `'${toolName}' is not allowlisted for this subagent`,
      requiresApproval: false,
    }
  }
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
      if (/[;&|`\n<>]/.test(cmd) || cmd.includes("$(")) {
        return {
          allowed: false,
          reason: `Bash command contains chaining/redirection metacharacters (allowlist bypass risk)`,
          requiresApproval: false,
        }
      }
      if (!policy.bashAllow.some((p) => cmd.startsWith(p))) {
        return {
          allowed: false,
          reason: `Bash command does not start with any allowlisted prefix`,
          requiresApproval: false,
        }
      }
    }
  }
  const requiresApproval = policy.approvalRequired?.includes(toolName) ?? false
  return { allowed: true, requiresApproval }
}

export function buildAgentsCatalog(agents: AgentDef[]): string {
  if (agents.length === 0) return ""
  const lines = ["# Available Agents (delegatable)"]
  lines.push(
    "Delegate complex subtasks to an agent with the `spawn_agent` tool. The agent runs its own tool loop and returns a final summary.",
  )
  lines.push("")
  for (const a of agents) {
    const tag = a.pluginId ? ` [plugin:${a.pluginId}]` : ""
    lines.push(`- **${a.name}** (${a.scope}${tag}): ${a.description}`)
  }
  return lines.join("\n")
}
