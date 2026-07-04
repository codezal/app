import { useEffect, useState } from "react"
import { Copy, Minus, Square, X } from "@/lib/icons"
import { isMacOS } from "@/lib/platform"
import { useT } from "@/lib/i18n/useT"

export function WindowControls() {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  const hidden = isMacOS()

  useEffect(() => {
    if (hidden) return
    let unlisten: (() => void) | undefined
    let alive = true
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const w = getCurrentWindow()
        const sync = async () => {
          try {
            const m = await w.isMaximized()
            if (alive) setMaximized(m)
          } catch {
            /* yoksay */
          }
        }
        await sync()
        unlisten = await w.onResized(() => void sync())
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [hidden])

  if (hidden) return null

  async function run(action: "minimize" | "toggle" | "close") {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const w = getCurrentWindow()
      if (action === "minimize") await w.minimize()
      else if (action === "toggle") await w.toggleMaximize()
      else await w.close()
    } catch {
      /* yoksay */
    }
  }

  const btn =
    "flex h-7 w-10 items-center justify-center text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"

  return (
    <div className="relative z-10 flex shrink-0 items-center">
      <button type="button" onClick={() => void run("minimize")} title={t("windowControls.minimize")} className={btn}>
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void run("toggle")}
        title={maximized ? t("windowControls.restore") : t("windowControls.maximize")}
        className={btn}
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => void run("close")}
        title={t("windowControls.close")}
        className="flex h-7 w-10 items-center justify-center text-codezal-dim transition-colors hover:bg-red-600 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
