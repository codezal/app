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
}

const lastCwd = new Map<string, string>()

export async function runBash(
  workspace: string,
  command: string,
  opts: RunBashOptions = {},
): Promise<string> {
  if (!workspace) throw new Error("Çalışma klasörü bağlı değil — bash çalıştırılamaz")
  const timeoutMs = opts.timeoutMs ?? useSettingsStore.getState().settings.bashTimeoutMs ?? 30_000
  const sid = opts.sessionId ?? useSessionsStore.getState().active?.id ?? "default"
  const cwd = lastCwd.get(sid) ?? workspace
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
        `[komut ${Math.round(timeoutMs / 1000)}s sürdü — öldürülmeyip arka plana alındı]\n` +
        `jobId: ${detachedJobId}. bash_status({ id: "${detachedJobId}" }) ile çıktıyı ve ` +
        `durumu izle; tamamlanınca bildirim gelir.`
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
