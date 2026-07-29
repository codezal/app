// Auto-close for AI-transient right-panel modes. The agents / preview panes are
// opened by the AI itself (agent-card pushed, preview navigation) and the todo
// pane is driven by useTodoPanelAuto — none of them should linger once the run
// that produced them finishes. This hook tracks which modes the AI opened,
// arms a close on the streaming true→false edge, and drops the panel back to
// closed. Modes the user opened by hand are never touched.
import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import { AI_TRANSIENT_MODES, type PanelMode } from "@/lib/panel-modes"

export function useAiPanelAuto(
  panelMode: PanelMode | null,
  setPanelMode: Dispatch<SetStateAction<PanelMode | null>>,
  activeStreaming: boolean,
) {
  // Modes currently owned by the AI (opened via agent-card / preview events).
  const aiOpenedRef = useRef<Set<PanelMode>>(new Set())
  const armedRef = useRef(false)
  const prevStreamingRef = useRef(activeStreaming)

  const markAiOpened = useCallback((m: PanelMode) => {
    aiOpenedRef.current.add(m)
  }, [])

  // Arm the close when the foreground run finishes.
  useEffect(() => {
    const was = prevStreamingRef.current
    prevStreamingRef.current = activeStreaming
    if (was && !activeStreaming) armedRef.current = true
  }, [activeStreaming])

  useEffect(() => {
    // Drop ownership for modes no longer showing — a later manual open of the
    // same mode must not be mistaken for an AI-owned pane.
    for (const m of aiOpenedRef.current) {
      if (m !== panelMode) aiOpenedRef.current.delete(m)
    }

    if (!armedRef.current) return
    armedRef.current = false
    if (panelMode == null) return
    // The todo pane is always AI-driven (todos only come from a run), so it
    // needs no ownership mark; agents / preview close only if the AI opened
    // them. Any other mode (files, suggestions, …) is left untouched.
    const aiOwned = panelMode === "todo" || aiOpenedRef.current.has(panelMode)
    if (AI_TRANSIENT_MODES.has(panelMode) && aiOwned) {
      aiOpenedRef.current.delete(panelMode)
      setPanelMode(null)
    }
  }, [panelMode, setPanelMode])

  return markAiOpened
}
