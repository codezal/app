
type Listener = () => void
const listeners = new Set<Listener>()

export function onGitChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitGitChanged(): void {
  for (const fn of [...listeners]) fn()
}
