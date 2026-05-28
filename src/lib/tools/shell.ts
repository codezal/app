// Shell tool — bash -lc ile komut çalıştır, workspace cwd, 30s timeout.
import { Command } from "@tauri-apps/plugin-shell"
import { applyCompact } from "@/lib/token-savers"
import type { CompactOutputSettings } from "@/lib/token-savers/types"

export type RunBashOptions = {
  timeoutMs?: number
  // When provided and enabled, output is filtered before the 50KB hard cap.
  // The footer added by applyCompact records the savings so the model can see
  // how aggressive the filter was for this command.
  compactOutput?: CompactOutputSettings
}

export async function runBash(
  workspace: string,
  command: string,
  opts: RunBashOptions = {},
): Promise<string> {
  if (!workspace) throw new Error("Çalışma klasörü bağlı değil — bash çalıştırılamaz")
  const timeoutMs = opts.timeoutMs ?? 30_000
  // cd ile workspace'e gir, sonra komut. -c tek string alır.
  const wrapped = `cd ${shellQuote(workspace)} && ${command}`
  const cmd = Command.create("bash", ["-lc", wrapped])

  // Timeout: yarış ile abort
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout (${timeoutMs}ms)`)), timeoutMs) as unknown as number
  })

  try {
    const output = await Promise.race([cmd.execute(), timeout])
    if (timer) clearTimeout(timer)
    const stdout = output.stdout.trim()
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
    if (compacted.length > 50_000) {
      return compacted.slice(0, 50_000) + `\n... (kesildi, toplam ${compacted.length} char)`
    }
    return compacted
  } catch (e) {
    if (timer) clearTimeout(timer)
    throw e
  }
}

// Shell tek tırnak içinde kaçışsız geçirmek için
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}
