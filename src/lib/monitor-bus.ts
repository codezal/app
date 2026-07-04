
export type MonitorEvent = {
  sessionId: string
  line: string
  monitorId: string
}

type Listener = (ev: MonitorEvent) => void

const subs = new Set<Listener>()

export function subscribeMonitor(cb: Listener): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

export function emitMonitor(ev: MonitorEvent): void {
  for (const cb of [...subs]) cb(ev)
}

// Test izolasyonu.
export function clearMonitorBus(): void {
  subs.clear()
}
