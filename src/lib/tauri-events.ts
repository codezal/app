import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type BufferedListener<T> = {
  attach: (cb: (payload: T) => void) => UnlistenFn
  dispose: () => void
}

export type BufferedListenOpts = {
  limit?: number
}

export async function bufferedListen<T>(
  event: string,
  opts: BufferedListenOpts = {},
): Promise<BufferedListener<T>> {
  const limit = opts.limit ?? 1024
  const early: T[] = []
  let sink: ((payload: T) => void) | null = null

  const unlisten = await listen<T>(event, (ev) => {
    if (sink) {
      sink(ev.payload)
      return
    }
    early.push(ev.payload)
    if (early.length > limit) early.shift()
  })

  return {
    attach(cb) {
      sink = cb
      if (early.length) {
        const buffered = early.splice(0)
        for (const p of buffered) cb(p)
      }
      return () => {
        if (sink === cb) sink = null
      }
    },
    dispose() {
      unlisten()
      sink = null
      early.length = 0
    },
  }
}
