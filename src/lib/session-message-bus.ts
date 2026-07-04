//

export type SessionMessageEvent = {
  toSessionId: string
  fromLabel: string
  text: string
}

type Listener = (ev: SessionMessageEvent) => void

const subs = new Set<Listener>()

export function subscribeSessionMessage(cb: Listener): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

export function emitSessionMessage(ev: SessionMessageEvent): void {
  for (const cb of [...subs]) cb(ev)
}

// Test izolasyonu.
export function clearSessionMessageBus(): void {
  subs.clear()
}
