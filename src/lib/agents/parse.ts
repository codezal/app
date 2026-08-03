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
  // `tools: []` / `bash_allow: []` mean "allow NOTHING" — an explicit empty
  // lock. Only ABSENT keys stay undefined (no restriction). Falsy checks or
  // length guards elsewhere must not re-interpret `[]` as "unset" (M45).
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

/**
 * Remove `quote`-delimited spans from a shell command, keeping everything
 * else. Used to test for shell metacharacters without tripping over string
 * literals. Backslash-escaped quotes outside a span do not start one.
 */
function stripQuotedSpans(cmd: string, quote: '"' | "'"): string {
  let out = ""
  let inSpan = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (inSpan) {
      if (c === quote) inSpan = false
      continue
    }
    if (c === "\\" && i + 1 < cmd.length) {
      out += c + cmd[++i]
      continue
    }
    if (c === quote) {
      inSpan = true
      continue
    }
    out += c
  }
  return out
}

/**
 * Split a shell command on chaining operators (&&, ||, ;, |, newline) that
 * appear OUTSIDE single/double quotes. Returns trimmed non-empty segments.
 */
function splitShellSegments(cmd: string): string[] {
  const segments: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote) {
      // Inside double quotes a backslash still escapes the next char, so an
      // escaped quote does not close the span.
      if (c === "\\" && quote === '"' && i + 1 < cmd.length) {
        current += c + cmd[++i]
        continue
      }
      if (c === quote) quote = null
      current += c
      continue
    }
    if (c === "\\" && i + 1 < cmd.length) {
      current += c + cmd[++i]
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    if (c === "\n" || c === ";") {
      if (current.trim()) segments.push(current.trim())
      current = ""
      continue
    }
    if (c === "|") {
      if (current.trim()) segments.push(current.trim())
      current = ""
      if (cmd[i + 1] === "|") i++ // consume the second | of ||
      continue
    }
    if (c === "&" && cmd[i + 1] === "&") {
      if (current.trim()) segments.push(current.trim())
      current = ""
      i++ // consume the second &
      continue
    }
    current += c
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

export function checkSubagentPolicy(
  policy: SubagentPolicy,
  toolName: string,
  input: unknown,
): { allowed: boolean; reason?: string; requiresApproval: boolean } {
  if (policy.planMode) {
    // Plan mode forbids writes. `bash` is blocked too, UNLESS the agent
    // declares an explicit `bash_allow` list — that lets a read-only
    // reviewer/refactorer fetch the change set itself (e.g. `git diff`)
    // while still keeping the shell locked to those allowlisted commands.
    // Without `bash_allow`, bash stays fully blocked (no unrestricted shell).
    const writeBlocked = new Set(["write_file", "edit_file", "apply_patch"])
    if (writeBlocked.has(toolName)) {
      return {
        allowed: false,
        reason: `Subagent is in plan mode; '${toolName}' cannot be used`,
        requiresApproval: false,
      }
    }
    if (toolName === "bash") {
      const hasAllow = Array.isArray(policy.bashAllow) && policy.bashAllow.length > 0
      if (!hasAllow) {
        return {
          allowed: false,
          reason: `Subagent is in plan mode; 'bash' requires an explicit bash_allow list`,
          requiresApproval: false,
        }
      }
      // fall through to the bash allowlist enforcement below
    }
  }
  if (policy.denyTools?.includes(toolName)) {
    return {
      allowed: false,
      reason: `'${toolName}' is denylisted for this subagent`,
      requiresApproval: false,
    }
  }
  if (policy.tools !== undefined && !policy.tools.includes(toolName)) {
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
    // `bash_allow: []` is an explicit "allow no bash commands" lock, not
    // "unset". Guard on `!== undefined` so an empty allowlist still enters
    // enforcement and blocks every command (M45).
    if (policy.bashAllow !== undefined) {
      // Backticks, command substitution, and redirections are always blocked —
      // they can exfiltrate data or execute arbitrary code regardless of prefix.
      // Quote-aware: '...' spans are inert literals (no substitution, no
      // redirection), "..." spans still allow $( ) and backticks but a quoted
      // '>' is just a character (e.g. grep "a > b"), so each check strips the
      // appropriate quoted spans first. The old naive regexes rejected
      // allowlisted commands whose patterns merely CONTAINED these chars.
      const noSingle = stripQuotedSpans(cmd, "'")
      const noQuotes = stripQuotedSpans(stripQuotedSpans(cmd, "'"), '"')
      if (/`/.test(noSingle) || noSingle.includes("$(") || /[<>]/.test(noQuotes)) {
        return {
          allowed: false,
          reason: `Bash command contains redirection or command substitution (allowlist bypass risk). The sandbox will keep blocking these — retry the SAME command with NO redirection: drop '>', '<', '2>', '| … >file', and '$(...)'. To read a line range use the read_file tool or 'sed -n' (both allowlisted); never redirect.`,
          requiresApproval: false,
        }
      }
      // Split by chaining operators (&&, ||, ;, |, newline) and validate each
      // segment against the allowlist independently. This allows legitimate
      // chained commands like "git diff && git status" while still blocking
      // "git diff; rm -rf /". Quote-aware: operators inside quotes are pattern
      // literals (e.g. grep "foo|bar" file) and must not split the command —
      // the old naive regex split produced bogus segments like `bar' src/`
      // and rejected the whole command (false positive).
      const segments = splitShellSegments(cmd)
      for (const seg of segments) {
        // Normalise `git -C <path> <subcmd>` → `git <subcmd>` so that the
        // allowlist prefix (e.g. "git status") matches regardless of the
        // working-directory override flag.
        const normalised = seg.replace(/^git\s+-C\s+\S+\s+/, "git ")
        if (!policy.bashAllow.some((p) => normalised.startsWith(p))) {
          return {
            allowed: false,
            reason: `Bash command segment not allowlisted: '${seg.slice(0, 60)}'. This subagent's bash is locked to a read-only allowlist — use an allowlisted command (git diff/log/show/status/blame, grep, sed -n, awk, cat, head, tail, ls, find) or the read_file/grep/code_* tools instead.`,
            requiresApproval: false,
          }
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
  lines.push("## When to delegate")
  lines.push(
    "Spawn an agent when a subtask is SELF-CONTAINED and benefits from focused, uninterrupted execution:",
  )
  lines.push(
    "- Code review of a diff, file, or module (use a reviewer agent instead of reviewing inline)",
  )
  lines.push(
    "- Writing or running tests for code you just changed (use a test agent)",
  )
  lines.push(
    "- Debugging a specific failure with hypothesis-driven investigation (use a debugger agent)",
  )
  lines.push(
    "- Multi-file refactoring or cleanup that can be specified precisely (use a refactorer agent)",
  )
  lines.push(
    "- Research across many files or docs where you need a synthesized answer (use an explorer agent)",
  )
  lines.push(
    "- Writing documentation for code you just implemented (use a doc-writer agent)",
  )
  lines.push("")
  lines.push(
    "Do NOT delegate trivial single-step actions (reading one file, running one grep). Delegate when the subtask would take you 5+ tool calls and can be fully specified up front.",
  )
  lines.push("")
  lines.push("Task spec — bad vs good:")
  lines.push(
    '- Bad: "Review this code" · "Fix the bug" · "Write tests"',
  )
  lines.push(
    '- Good: "Review src/lib/auth/validate.ts for null-safety issues in the token refresh path. Report findings as severity-tagged list with line numbers and suggested fixes."',
  )
  lines.push(
    '- Good: "Write unit tests for src/lib/compact.ts — cover the hysteresis trigger logic and edge cases (empty messages, token count 0). Run them with `npx vitest run tests/compact.test.ts` and fix failures."',
  )
  lines.push("")
  lines.push("## Agents")
  for (const a of agents) {
    const tag = a.pluginId ? ` [plugin:${a.pluginId}]` : ""
    lines.push(`- **${a.name}** (${a.scope}${tag}): ${a.description}`)
  }
  return lines.join("\n")
}
