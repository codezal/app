import { useCallback, useEffect, useRef, useState } from "react"
import { useSessionsStore } from "@/store/sessions"

//
export function useNavHistory(activeFile: string | null, activeSessionId: string | null) {
  const navRef = useRef<{ sid: string | null; stack: (string | null)[]; pos: number; suppress: boolean }>({
    sid: null,
    stack: [null],
    pos: 0,
    suppress: false,
  })
  const [navCan, setNavCan] = useState<{ back: boolean; forward: boolean }>({ back: false, forward: false })

  useEffect(() => {
    const n = navRef.current
    if (activeSessionId !== n.sid) {
      n.sid = activeSessionId
      n.stack = [activeFile]
      n.pos = 0
      n.suppress = false
    } else if (n.suppress) {
      n.suppress = false
    } else if (n.stack[n.pos] !== activeFile) {
      n.stack = [...n.stack.slice(0, n.pos + 1), activeFile]
      n.pos = n.stack.length - 1
    }
    setNavCan({ back: n.pos > 0, forward: n.pos < n.stack.length - 1 })
  }, [activeFile, activeSessionId])

  const navBack = useCallback(() => {
    const n = navRef.current
    if (n.pos <= 0) return
    n.pos -= 1
    n.suppress = true
    useSessionsStore.getState().setActiveFile(n.stack[n.pos] ?? null)
    setNavCan({ back: n.pos > 0, forward: n.pos < n.stack.length - 1 })
  }, [])

  const navForward = useCallback(() => {
    const n = navRef.current
    if (n.pos >= n.stack.length - 1) return
    n.pos += 1
    n.suppress = true
    useSessionsStore.getState().setActiveFile(n.stack[n.pos] ?? null)
    setNavCan({ back: n.pos > 0, forward: n.pos < n.stack.length - 1 })
  }, [])

  return { navCan, navBack, navForward }
}
