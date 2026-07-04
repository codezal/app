import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useSessionsStore } from "@/store/sessions"
import type { TodoItem } from "@/store/types"
import type { PanelMode } from "@/components/TabBar"

export function hasActiveTodos(todos: TodoItem[] | undefined, streaming: boolean): boolean {
  if (!todos || todos.length === 0) return false
  if (!streaming) return false
  const done = todos.filter((t) => t.status === "completed" || t.status === "cancelled").length
  return done < todos.length
}

//
export function useTodoPanelAuto(
  panelMode: PanelMode | null,
  setPanelMode: Dispatch<SetStateAction<PanelMode | null>>,
  activeStreaming: boolean,
) {
  const todos = useSessionsStore((s) => s.active?.todos)
  const activeId = useSessionsStore((s) => s.activeId)
  const active = hasActiveTodos(todos, activeStreaming)

  const panelModeRef = useRef(panelMode)
  useEffect(() => {
    panelModeRef.current = panelMode
  }, [panelMode])

  const restoreRef = useRef<PanelMode | null>(null)
  const expectedRef = useRef<PanelMode | null>(panelMode)
  const prevActiveRef = useRef(false)
  const autoEngagedRef = useRef(false)

  useEffect(() => {
    if (autoEngagedRef.current && panelMode !== expectedRef.current) {
      autoEngagedRef.current = false
      restoreRef.current = null
    }
  }, [panelMode])

  useEffect(() => {
    autoEngagedRef.current = false
    restoreRef.current = null
    prevActiveRef.current = active
    expectedRef.current = panelModeRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    const wasActive = prevActiveRef.current
    prevActiveRef.current = active
    if (active && !wasActive) {
      restoreRef.current = panelModeRef.current
      autoEngagedRef.current = true
      expectedRef.current = "todo"
      setPanelMode("todo")
    } else if (!active && wasActive) {
      if (autoEngagedRef.current) {
        const back = restoreRef.current
        autoEngagedRef.current = false
        expectedRef.current = back
        // (m !== "todo") dokunma.
        setPanelMode((m) => (m === "todo" ? back : m))
      }
      restoreRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
