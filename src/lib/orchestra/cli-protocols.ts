// CLI runner ortak yardımcıları — bash -lc ile binary spawn, stdout/stderr stream.
// Her CLI'nin kendi command builder'ı var; bu modül stream parse ve event emit kısmını
// tek noktadan yönetir.
import { Command } from "@tauri-apps/plugin-shell"
import type { WorkerEvent } from "./types"

export type CliSpawnInput = {
  // Bash içinde çalıştırılacak ham komut (binary + arg)
  bashLine: string
  workspacePath?: string
  // Worker'a verilen ham task — log için
  task: string
  signal: AbortSignal
  emit: (event: WorkerEvent) => void
  // Opsiyonel: stream-json parser. Verilmezse satır satır text-delta olarak emit.
  parseLine?: (line: string) => WorkerEvent[] | null
}

export type CliSpawnResult = {
  fullText: string
  exitCode: number | null
  aborted: boolean
}

// Bash içinde tek tırnaklı string'e güvenli kaçış
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// CLI subprocess'i spawn, stdout/stderr satır satır oku, event'leri emit et.
// abort → child.kill, finally exit code.
export async function spawnCliWorker(input: CliSpawnInput): Promise<CliSpawnResult> {
  const { bashLine, workspacePath, signal, emit, parseLine } = input

  // workspace bağlıysa `cd <ws> && <bashLine>` — değilse direkt çalıştır
  const wrapped = workspacePath
    ? `cd ${shellQuote(workspacePath)} && ${bashLine}`
    : bashLine

  const cmd = Command.create("bash", ["-lc", wrapped])

  let fullText = ""
  let exitCode: number | null = null

  const stdoutBuf = { rest: "" }
  const stderrBuf = { rest: "" }

  // Stdout — satır satır ayır, parser varsa onun event'lerini emit, yoksa text-delta
  cmd.stdout.on("data", (line) => {
    // Tauri stdout events satır bazlı gelir ama bazen birden fazla satır olabilir
    const chunk = stdoutBuf.rest + line
    const parts = chunk.split("\n")
    stdoutBuf.rest = parts.pop() ?? ""
    for (const ln of parts) {
      if (!ln) continue
      fullText += ln + "\n"
      if (parseLine) {
        const evs = parseLine(ln)
        if (evs) {
          for (const ev of evs) emit(ev)
          continue
        }
      }
      emit({ type: "text-delta", delta: ln + "\n" })
    }
  })

  cmd.stderr.on("data", (line) => {
    const chunk = stderrBuf.rest + line
    const parts = chunk.split("\n")
    stderrBuf.rest = parts.pop() ?? ""
    for (const ln of parts) {
      if (!ln) continue
      emit({ type: "log", line: `[stderr] ${ln}` })
    }
  })

  const exited = new Promise<void>((resolve) => {
    cmd.on("close", (payload) => {
      exitCode = (payload as { code?: number | null }).code ?? null
      // Kalan buffer'ları flush et
      if (stdoutBuf.rest) {
        fullText += stdoutBuf.rest
        if (parseLine) {
          const evs = parseLine(stdoutBuf.rest)
          if (evs) for (const ev of evs) emit(ev)
          else emit({ type: "text-delta", delta: stdoutBuf.rest })
        } else {
          emit({ type: "text-delta", delta: stdoutBuf.rest })
        }
      }
      if (stderrBuf.rest) {
        emit({ type: "log", line: `[stderr] ${stderrBuf.rest}` })
      }
      resolve()
    })
  })

  emit({ type: "started" })
  const child = await cmd.spawn()

  // Abort handler — kill child. SIGTERM yetmezse 2s sonra exit'i zorla çöz
  // (CLI stdin'de takıldıysa close eventi gelmeyebilir).
  let killed = false
  let forceResolveExit: (() => void) | null = null

  const killAndForce = () => {
    void child.kill().catch(() => {})
    // Tauri kill genelde SIGKILL — close eventi ~hemen gelir. Garantiye 2s timeout.
    setTimeout(() => {
      if (forceResolveExit) forceResolveExit()
    }, 2000)
  }

  if (signal.aborted) {
    killed = true
    killAndForce()
  } else {
    signal.addEventListener(
      "abort",
      () => {
        killed = true
        killAndForce()
      },
      { once: true },
    )
  }

  // exited promise + force resolve yarışı
  await new Promise<void>((resolve) => {
    forceResolveExit = resolve
    void exited.then(resolve)
  })

  return { fullText: fullText.trim(), exitCode, aborted: killed }
}
