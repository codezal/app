import { runShell } from "@/lib/exec"
import { applyCompact } from "@/lib/token-savers"
import type { CompactOutputSettings } from "@/lib/token-savers/types"
import { estimateTextTokens } from "@/lib/tokens"
import { recordSavings } from "@/store/token-savings"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { useJobsStore } from "@/store/jobs"
import { PWD_SENTINEL, extractPwd, isWithinWorkspace } from "./shell-cwd"
import { truncateOutput } from "./truncate"

export type RunBashOptions = {
  timeoutMs?: number
  // When provided and enabled, output is filtered before the 50KB hard cap.
  // The footer added by applyCompact records the savings so the model can see
  // how aggressive the filter was for this command.
  compactOutput?: CompactOutputSettings
  sessionId?: string
  // Explicit working directory — bypasses the per-session lastCwd cache. Used
  // by non-interactive callers (formatters) whose commands embed RELATIVE
  // paths: a cached cwd deep inside the workspace would resolve those against
  // the wrong directory (M9).
  cwd?: string
}

const lastCwd = new Map<string, string>()

export async function runBash(
  workspace: string,
  command: string,
  opts: RunBashOptions = {},
): Promise<string> {
  if (!workspace) throw new Error("No workspace attached — cannot run bash")
  const timeoutMs = opts.timeoutMs ?? useSettingsStore.getState().settings.bashTimeoutMs ?? 30_000
  const sid = opts.sessionId ?? useSessionsStore.getState().active?.id ?? "default"
  // A cached cwd from a previous workspace must not leak into the current one:
  // if the session's workspace changed, the stale cached dir falls outside it
  // and would otherwise pin every command to the old workspace forever (the
  // post-run `set` never fires because the dir isn't within the new workspace).
  const cached = lastCwd.get(sid)
  const cwd = opts.cwd
    ? opts.cwd
    : cached && isWithinWorkspace(workspace, cached)
      ? cached
      : workspace
  const wrapped =
    `cd ${shellQuote(cwd)} && { ${command}\n}; __cz=$?; ` +
    `printf '${PWD_SENTINEL}%s\\n' "$(pwd)"; exit $__cz`

  let output
  let detachedJobId: string | null = null
  try {
    output = await runShell(wrapped, {
      timeoutMs,
      onTimeout: (cmd, child, partial) => {
        detachedJobId = useJobsStore.getState().adopt(cmd, child, command, sid, partial)
      },
    })
  } catch (e) {
    if (detachedJobId) {
      return (
        `[command ran ${Math.round(timeoutMs / 1000)}s — moved to the background instead of being killed]\n` +
        `jobId: ${detachedJobId}. Track output and status with bash_status({ id: "${detachedJobId}" }); ` +
        `you will be notified when it finishes.`
      )
    }
    throw e
  }
  const { cleaned, cwd: newCwd } = extractPwd(output.stdout, PWD_SENTINEL)
  if (newCwd && isWithinWorkspace(workspace, newCwd)) lastCwd.set(sid, newCwd)
  const stdout = cleaned.trim()
  const stderr = output.stderr.trim()
  const parts: string[] = []
  if (stdout) parts.push(stdout)
  if (stderr) parts.push("[stderr]\n" + stderr)
  parts.push(`[exit ${output.code}]`)
  const raw = parts.join("\n")
  // Compact pipeline (no-op when disabled). Applied BEFORE the 50KB hard cap
  // because that's the whole point — fitting heavy output into less space.
  const compacted = opts.compactOutput?.enabled
    ? applyCompact(command, raw, opts.compactOutput)
    : raw
  if (opts.compactOutput?.enabled && compacted !== raw) {
    recordSavings("compactOutput", estimateTextTokens(raw) - estimateTextTokens(compacted))
  }
  const result = await truncateOutput(compacted, { direction: "middle" })
  return result.content
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}
