//
//   const menu = useMenu()
//   <div ref={menu.wrapRef} className="relative">
//     <button {...menu.triggerProps} title={...}>…</button>
//   </div>
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"

const FIRST_FOCUSABLE =
  'input:not([disabled]), [role^="menuitem"], button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export function useMenu() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus?.()
      }
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    menuRef.current?.querySelector<HTMLElement>(FIRST_FOCUSABLE)?.focus()
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const onMenuKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"], button:not([disabled])') ?? [],
    )
    if (items.length === 0) return
    e.preventDefault()
    const idx = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === "ArrowDown"
        ? items[idx < 0 ? 0 : (idx + 1) % items.length]
        : items[idx <= 0 ? items.length - 1 : idx - 1]
    next?.focus()
  }, [])

  const triggerProps = {
    ref: triggerRef,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    onClick: () => setOpen((v) => !v),
  }
  const menuProps = {
    ref: menuRef,
    role: "menu" as const,
    onKeyDown: onMenuKeyDown,
  }

  return { open, setOpen, close, wrapRef, triggerRef, menuRef, triggerProps, menuProps, onMenuKeyDown }
}
