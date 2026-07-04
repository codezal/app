// Global toast notifications — transient status feedback (success/error/info)
// shown by <Toaster/> (mounted once in App). Replaces inline status banners.
import { create } from "zustand"
import { createId } from "@/lib/id"

export type ToastKind = "success" | "error" | "info"
// Optional inline action (e.g. "Undo"). Clicking it runs onClick then dismisses.
export type ToastAction = { label: string; onClick: () => void }
export type Toast = { id: string; kind: ToastKind; message: string; action?: ToastAction }

const TOAST_TTL_MS = 3500

type ToastTimer = { handle: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }
const timers = new Map<string, ToastTimer>()

function armTimer(id: string, ms: number, fire: () => void) {
  const handle = setTimeout(fire, ms)
  timers.set(id, { handle, remaining: ms, startedAt: Date.now() })
}

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t) clearTimeout(t.handle)
  timers.delete(id)
}

type ShowOptions = {
  kind?: ToastKind
  // Override the auto-dismiss window (ms). Longer for actionable toasts.
  duration?: number
  action?: ToastAction
}

type ToastState = {
  toasts: Toast[]
  push: (kind: ToastKind, message: string) => void
  // Richer API — supports a custom duration and an inline action button.
  show: (message: string, opts?: ShowOptions) => void
  dismiss: (id: string) => void
  pause: (id: string) => void
  resume: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => get().show(message, { kind }),
  show: (message, opts) => {
    const id = createId("toast")
    const kind = opts?.kind ?? "info"
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action: opts?.action }] }))
    // Auto-dismiss after the (optionally overridden) window.
    armTimer(id, opts?.duration ?? TOAST_TTL_MS, () => get().dismiss(id))
  },
  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  pause: (id) => {
    const t = timers.get(id)
    if (!t) return
    clearTimeout(t.handle)
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt))
  },
  resume: (id) => {
    const t = timers.get(id)
    if (!t) return
    armTimer(id, t.remaining, () => get().dismiss(id))
  },
}))

// Convenience API — call from anywhere: toast.success("Saved").
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  info: (message: string) => useToastStore.getState().push("info", message),
}
