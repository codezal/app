import { useEffect, useState } from "react"

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true)
  useEffect(() => {
    // M81: hold the unlisten fn in a ref so cleanup ALWAYS sees it — the old
    // local `unlisten` was assigned only after two awaits, so unmounting before
    // onFocusChanged resolved leaked the Tauri listener (StrictMode double-
    // register symptoms).
    let unlistenRef: (() => void) | undefined
    let alive = true
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const w = getCurrentWindow()
        try {
          const f = await w.isFocused()
          if (alive) setFocused(f)
        } catch {
          /* yoksay */
        }
        if (!alive) return
        const off = await w.onFocusChanged(({ payload }) => {
          if (alive) setFocused(payload)
        })
        unlistenRef = off
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      alive = false
      unlistenRef?.()
    }
  }, [])
  return focused
}
