// PTY JS wrapper — Tauri invoke + event subscription.
//   const handle = await spawnPty({ rows, cols, cwd, shell })
//   handle.onData(chunk => term.write(chunk))
//   handle.onExit(() => term.write('\r\n[exited]'))
//   handle.write(input)
//   handle.resize(rows, cols)
//   handle.kill()
import { invoke } from "@tauri-apps/api/core"
import { createId } from "@/lib/id"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type PtySpawnOpts = {
  rows: number
  cols: number
  cwd?: string
  shell?: string
  env?: Record<string, string>
}

export type PtyHandle = {
  id: string
  write: (data: string) => Promise<void>
  resize: (rows: number, cols: number) => Promise<void>
  kill: () => Promise<void>
  onData: (cb: (data: string) => void) => Promise<UnlistenFn>
  onExit: (cb: () => void) => Promise<UnlistenFn>
  dispose: () => Promise<void>
}

export async function spawnPty(opts: PtySpawnOpts): Promise<PtyHandle> {
  const id = createId("terminal")

  const early: string[] = []
  let earlyBytes = 0
  let exitedEarly = false
  let dataSink: ((chunk: string) => void) | null = null
  let exitSink: (() => void) | null = null

  const EARLY_LIMIT = 256 * 1024

  const unData = await listen<string>(`pty:data:${id}`, (ev) => {
    if (dataSink) {
      dataSink(ev.payload)
      return
    }
    early.push(ev.payload)
    earlyBytes += ev.payload.length
    while (earlyBytes > EARLY_LIMIT && early.length > 1) {
      earlyBytes -= early.shift()!.length
    }
  })
  const unExit = await listen(`pty:exit:${id}`, () => {
    if (exitSink) exitSink()
    else exitedEarly = true
  })

  try {
    await invoke<string>("pty_spawn", {
      args: {
        id,
        rows: opts.rows,
        cols: opts.cols,
        cwd: opts.cwd,
        shell: opts.shell,
        env: opts.env,
      },
    })
  } catch (e) {
    unData()
    unExit()
    throw e
  }

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (rows, cols) => invoke("pty_resize", { id, rows, cols }),
    kill: () => invoke("pty_kill", { id }),
    onData: async (cb) => {
      dataSink = cb
      if (early.length) {
        const buffered = early.splice(0)
        earlyBytes = 0
        for (const chunk of buffered) cb(chunk)
      }
      return () => {
        if (dataSink === cb) dataSink = null
      }
    },
    onExit: async (cb) => {
      exitSink = cb
      if (exitedEarly) {
        exitedEarly = false
        cb()
      }
      return () => {
        if (exitSink === cb) exitSink = null
      }
    },
    dispose: async () => {
      unData()
      unExit()
      dataSink = null
      exitSink = null
      try {
        await invoke("pty_kill", { id })
      } catch {
        // Intentionally ignored.
      }
    },
  }
}
