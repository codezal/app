import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useSessionsStore } from "@/store/sessions"
import type { PanelMode } from "@/components/TabBar"

type MenuActions = {
  newChat: () => void
  newProject: () => void
  toggleSplit: () => void
  settings: () => void
}

type ShortcutArgs = {
  openNewSession: (persist: boolean) => Promise<void>
  setShowPalette: Dispatch<SetStateAction<boolean>>
  setShowSettings: Dispatch<SetStateAction<boolean>>
  setShowSearch: Dispatch<SetStateAction<boolean>>
  setShowChatSearch: Dispatch<SetStateAction<boolean>>
  setShowForkDialog: Dispatch<SetStateAction<boolean>>
  setPanelMode: Dispatch<SetStateAction<PanelMode | null>>
  toggleTerminal: () => void
  menuRef: { current: MenuActions }
}

// ⌘⇧G fork · ⌘B Files paneli · ⌘⇧T terminal · ⌘M plan/build toggle · ⌘\ split.
//
export function useKeyboardShortcuts(args: ShortcutArgs) {
  const ref = useRef(args)
  useEffect(() => {
    ref.current = args
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const a = ref.current
      if (e.code === "KeyN" || e.key === "n" || e.key === "N") {
        e.preventDefault()
        if (e.shiftKey) {
          a.menuRef.current.newProject()
        } else {
          void a.openNewSession(false)
        }
      } else if (e.key === "k") {
        e.preventDefault()
        a.setShowPalette((v) => !v)
      } else if (e.key === ",") {
        e.preventDefault()
        a.setShowSettings((v) => !v)
      } else if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault()
        a.setShowSearch((v) => !v)
      } else if (!e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault()
        a.setShowChatSearch((v) => !v)
      } else if (e.shiftKey && (e.key === "G" || e.key === "g")) {
        e.preventDefault()
        a.setShowForkDialog((v) => !v)
      } else if (e.key === "b") {
        e.preventDefault()
        a.setPanelMode((m) => (m ? null : "files"))
      } else if (e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault()
        a.toggleTerminal()
      } else if (e.key === "m" || e.key === "M") {
        // Plan/Build mode toggle
        e.preventDefault()
        const cur = useSessionsStore.getState().active
        if (!cur) return
        const next = (cur.mode ?? "build") === "build" ? "plan" : "build"
        useSessionsStore.getState().setMode(next)
      } else if (e.key === "\\") {
        e.preventDefault()
        a.menuRef.current.toggleSplit()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
