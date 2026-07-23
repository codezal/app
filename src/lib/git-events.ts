
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

// Buffered "open the PR view" request. The status-bar CI-checks badge fires this;
// the git panel may be unmounted at that moment, so the request stays sticky until
// the panel subscribes and consumes it — afterwards live requests pass straight
// through to mounted listeners.
let pendingPrView = false
const prViewListeners = new Set<() => void>()

export function requestOpenPrView(): void {
  if (prViewListeners.size === 0) {
    pendingPrView = true
    return
  }
  for (const fn of [...prViewListeners]) fn()
}

export function onOpenPrView(fn: () => void): () => void {
  prViewListeners.add(fn)
  if (pendingPrView) {
    pendingPrView = false
    fn()
  }
  return () => {
    prViewListeners.delete(fn)
  }
}
