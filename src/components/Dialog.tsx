// Ortak modal/dialog primitive — WAI-ARIA APG "Dialog (Modal)" desenini tek yerde
//
//
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

type DialogProps = {
  onClose: () => void
  children: ReactNode
  role?: "dialog" | "alertdialog"
  labelledById?: string
  label?: string
  panelClassName?: string
  backdropClassName?: string
  align?: "center" | "start"
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  initialFocus?: RefObject<HTMLElement | null>
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  const sel =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

export function Dialog({
  onClose,
  children,
  role = "dialog",
  labelledById,
  label,
  panelClassName,
  backdropClassName,
  align = "center",
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocus,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const target =
      initialFocus?.current ?? (panel ? focusableWithin(panel)[0] : null) ?? panel
    target?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!closeOnEscape) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [closeOnEscape, onClose])

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return
    const panel = panelRef.current
    if (!panel) return
    const items = focusableWithin(panel)
    if (items.length === 0) {
      e.preventDefault()
      panel.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const activeEl = document.activeElement
    if (e.shiftKey && activeEl === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-sm",
        align === "center" ? "items-center" : "items-start",
        backdropClassName,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledById}
        aria-label={labelledById ? undefined : label}
        tabIndex={-1}
        className={cn("outline-none", panelClassName)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
