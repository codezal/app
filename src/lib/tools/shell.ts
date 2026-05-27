// Shell tool — bash -lc ile komut çalıştır, workspace cwd, 30s timeout.
import { Command } from "@tauri-apps/plugin-shell"

export async function runBash(
  workspace: string,
  command: string,
  timeoutMs = 30_000,
): Promise<string> {
  if (!workspace) throw new Error("Çalışma klasörü bağlı değil — bash çalıştırılamaz")
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
    const full = parts.join("\n")
    if (full.length > 50_000) {
      return full.slice(0, 50_000) + `\n... (kesildi, toplam ${full.length} char)`
    }
    return full
  } catch (e) {
    if (timer) clearTimeout(timer)
    throw e
  }
}

// Shell tek tırnak içinde kaçışsız geçirmek için
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}
