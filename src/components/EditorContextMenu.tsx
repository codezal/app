import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export type CtxMenuItem =
  | { kind: "sep" }
  | {
      kind: "item"
      label: string
      shortcut?: string
      icon?: ReactNode
      disabled?: boolean
      onClick: () => void
    }

type Props = {
  x: number
  y: number
  items: CtxMenuItem[]
  onClose: () => void
}

const WIDTH = 230

export function EditorContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    setPos({
      left: Math.min(x, window.innerWidth - WIDTH - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    })
  }, [x, y])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", onDown, true)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onClose)
    return () => {
      window.removeEventListener("mousedown", onDown, true)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, top: pos.top, width: WIDTH }}
      className="z-[100] overflow-hidden cz-menu py-1"
    >
      {items.map((it, i) =>
        it.kind === "sep" ? (
          <div key={i} className="my-1 h-px bg-codezal" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return
              onClose()
              it.onClick()
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm",
              it.disabled
                ? "cursor-default text-codezal-mute/50"
                : "text-codezal-text hover:bg-codezal-panel-2",
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-codezal-mute">
              {it.icon}
            </span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="shrink-0 text-sm tabular-nums opacity-60">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
