
type LockGrantedCallback = () => Promise<unknown>
interface LockManagerLike {
  request: (name: string, cb: LockGrantedCallback) => Promise<unknown>
}

function webLocks(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator
  const locks = nav?.locks
  if (locks && typeof (locks as LockManagerLike).request === "function") {
    return locks as LockManagerLike
  }
  return undefined
}

const chains = new Map<string, Promise<void>>()

async function withMemoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const mine = prev.then(() => gate)
  chains.set(key, mine)
  await prev.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
    if (chains.get(key) === mine) chains.delete(key)
  }
}

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = webLocks()
  if (locks) {
    return (await locks.request(key, async () => fn())) as T
  }
  return withMemoryLock(key, fn)
}
