import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { handleKey, initialVimState, type VimMode, type VimState } from "./engine"

export type UseVimOpts = {
  enabled: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  setText: (s: string) => void
  onEnter: () => void
  onUndo?: () => void
  menuOpen: boolean
}

export type UseVimResult = {
  mode: VimMode
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

export function useVim(opts: UseVimOpts): UseVimResult {
  const { enabled, textareaRef, text, setText, onEnter, onUndo, menuOpen } = opts
  const [vim, setVim] = useState<VimState>(() => initialVimState("insert"))
  const pendingSel = useRef<number | null>(null)

  useEffect(() => {
    if (pendingSel.current == null) return
    const el = textareaRef.current
    if (el) {
      const c = pendingSel.current
      el.selectionStart = el.selectionEnd = c
    }
    pendingSel.current = null
  }, [text, textareaRef])

  const [lastEnabled, setLastEnabled] = useState(enabled)
  if (enabled !== lastEnabled) {
    setLastEnabled(enabled)
    if (!enabled) setVim((s) => (s.mode === "insert" ? s : initialVimState("insert")))
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!enabled) return false
    const el = textareaRef.current
    if (!el) return false
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (menuOpen) return false

    if (vim.mode === "insert" && e.key !== "Escape") return false

    if (vim.mode === "normal" && e.key === "Enter") {
      if (e.shiftKey) return false
      e.preventDefault()
      onEnter()
      return true
    }
    if (vim.mode === "normal" && e.key === "u") {
      e.preventDefault()
      onUndo?.()
      return true
    }

    let key: string | null = null
    if (e.key === "Escape") key = "Escape"
    else if (e.key.length === 1) key = e.key
    if (key == null) {
      if (e.key.startsWith("Arrow")) return false
      e.preventDefault()
      return true
    }

    const model = { text, cursor: el.selectionStart ?? text.length }
    const out = handleKey(model, vim, key)
    setVim(out.state)
    if (!out.handled) return false

    e.preventDefault()
    if (out.model.text !== text) {
      pendingSel.current = out.model.cursor
      setText(out.model.text)
    } else {
      el.selectionStart = el.selectionEnd = out.model.cursor
    }
    return true
  }

  return { mode: vim.mode, onKeyDown }
}
