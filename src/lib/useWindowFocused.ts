import { useEffect, useState } from "react"

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true)
  useEffect(() => {
    let unlisten: (() => void) | undefined
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
        unlisten = await w.onFocusChanged(({ payload }) => {
          if (alive) setFocused(payload)
        })
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])
  return focused
}
