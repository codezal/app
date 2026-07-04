import { useEffect, useState } from "react"
import { useSessionsStore } from "@/store/sessions"
import type { MascotState } from "@/lib/mascots"

const THINKING_LEAD_MS = 4_000
const IDLE_TO_SLEEP_MS = 90_000

export function useMascotState(): MascotState {
  const activeId = useSessionsStore((s) => s.activeId)
  const isDraft = useSessionsStore((s) => s.isDraft)
  const streaming = useSessionsStore((s) => !!(s.activeId && s.streamingIds[s.activeId]))

  const base: MascotState = streaming ? "thinking" : isDraft || !activeId ? "greet" : "idle"

  const [state, setState] = useState<MascotState>(base)
  const [prevBase, setPrevBase] = useState(base)
  if (prevBase !== base) {
    setPrevBase(base)
    setState(base)
  }

  useEffect(() => {
    const next: MascotState | null =
      base === "thinking" ? "working" : base === "idle" ? "sleeping" : null
    if (!next) return
    const id = window.setTimeout(
      () => setState(next),
      base === "thinking" ? THINKING_LEAD_MS : IDLE_TO_SLEEP_MS,
    )
    return () => window.clearTimeout(id)
  }, [base])

  return state
}
