//
// (ContextPanel → composer, sidebar session → split pane) HTML5 yerine pointer
//
export type InternalDragData = { kind: string; payload: string; label: string }
type DropTarget = { el: HTMLElement; accepts: string; onDrop: (payload: string) => void }
type DragOpts = { onStart?: () => void; onEnd?: () => void }

const targets = new Set<DropTarget>()
let recentDrag = false

export function registerDropTarget(t: DropTarget): () => void {
  targets.add(t)
  return () => {
    targets.delete(t)
  }
}

export function wasDragging(): boolean {
  return recentDrag
}

function targetAt(x: number, y: number, kind: string): DropTarget | null {
  for (const t of targets) {
    if (t.accepts !== kind) continue
    const r = t.el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t
  }
  return null
}

export function startInternalDrag(
  e: { clientX: number; clientY: number },
  data: InternalDragData,
  opts: DragOpts = {},
): void {
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false
  let ghost: HTMLDivElement | null = null
  let hovered: DropTarget | null = null

  function setHover(t: DropTarget | null) {
    if (hovered === t) return
    if (hovered) {
      hovered.el.style.removeProperty("outline")
      hovered.el.style.removeProperty("outline-offset")
    }
    hovered = t
    if (hovered) {
      hovered.el.style.outline = "2px solid hsl(var(--codezal-accent))"
      hovered.el.style.outlineOffset = "2px"
    }
  }

  function onMove(ev: PointerEvent) {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      dragging = true
      opts.onStart?.()
      document.body.style.userSelect = "none"
      ghost = document.createElement("div")
      ghost.textContent = data.label
      ghost.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;padding:4px 10px;border-radius:8px;" +
        "background:hsl(var(--codezal-chip));color:hsl(var(--codezal-text));" +
        "border:1px solid hsl(var(--codezal-text) / 0.12);font-size:13px;" +
        "box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:240px;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap;"
      document.body.appendChild(ghost)
    }
    if (ghost) {
      ghost.style.left = `${ev.clientX + 12}px`
      ghost.style.top = `${ev.clientY + 12}px`
    }
    setHover(targetAt(ev.clientX, ev.clientY, data.kind))
  }

  function cleanup() {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onCancel)
    setHover(null)
    ghost?.remove()
    ghost = null
    document.body.style.removeProperty("user-select")
  }

  function onUp(ev: PointerEvent) {
    const target = dragging ? targetAt(ev.clientX, ev.clientY, data.kind) : null
    cleanup()
    if (dragging) {
      recentDrag = true
      setTimeout(() => {
        recentDrag = false
      }, 0)
      if (target) target.onDrop(data.payload)
      opts.onEnd?.()
    }
  }

  function onCancel() {
    const wasDrag = dragging
    cleanup()
    if (wasDrag) opts.onEnd?.()
  }

  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onCancel)
}
