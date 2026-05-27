// PTY JS wrapper — Tauri invoke + event subscription.
// Rust tarafı src-tauri/src/pty.rs içinde portable-pty kullanır.
// Akış:
//   const handle = await spawnPty({ rows, cols, cwd, shell })
//   handle.onData(chunk => term.write(chunk))
//   handle.onExit(() => term.write('\r\n[exited]'))
//   handle.write(input)
//   handle.resize(rows, cols)
//   handle.kill()
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type PtySpawnOpts = {
  rows: number
  cols: number
  cwd?: string
  shell?: string
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
  const id = crypto.randomUUID()
  await invoke<string>("pty_spawn", {
    id,
    rows: opts.rows,
    cols: opts.cols,
    cwd: opts.cwd,
    shell: opts.shell,
  })

  // Active listener'lar — dispose'da temizlenir
  const unlisteners: UnlistenFn[] = []

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (rows, cols) => invoke("pty_resize", { id, rows, cols }),
    kill: () => invoke("pty_kill", { id }),
    onData: async (cb) => {
      const un = await listen<string>(`pty:data:${id}`, (ev) => cb(ev.payload))
      unlisteners.push(un)
      return un
    },
    onExit: async (cb) => {
      const un = await listen(`pty:exit:${id}`, () => cb())
      unlisteners.push(un)
      return un
    },
    dispose: async () => {
      for (const un of unlisteners) un()
      try {
        await invoke("pty_kill", { id })
      } catch {
        // sessizce yut — zaten exit etmiş olabilir
      }
    },
  }
}
