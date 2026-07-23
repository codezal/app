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
    // The todo panel is owned by the session whose active todos auto-opened it.
    // On a session switch we must re-evaluate against the *new* session so an
    // empty panel never leaks into an unrelated chat, and a chat that does have
    // active todos shows them again when revisited.
    const wasAuto = autoEngagedRef.current
    const restore = restoreRef.current
    prevActiveRef.current = active
    expectedRef.current = panelModeRef.current

    if (active) {
      // New session has active todos: surface them and take ownership so the
      // panel auto-closes once they finish.
      if (panelModeRef.current !== "todo") {
        restoreRef.current = panelModeRef.current
        expectedRef.current = "todo"
        setPanelMode("todo")
      }
      autoEngagedRef.current = true
    } else {
      // New session has no active todos: a todo panel must never leak into an
      // unrelated chat. The todo tab is only meaningful while a session has
      // active todos (the menu entry is gated on the same condition), so if the
      // panel is sitting on "todo" — left over from a previous session, whether
      // auto-opened or not — drop it back to its prior mode or close it
      // entirely instead of showing an empty "no active tasks" list.
      if (panelModeRef.current === "todo") {
        const back = wasAuto ? restore : null
        expectedRef.current = back
        setPanelMode((m) => (m === "todo" ? back : m))
      }
      autoEngagedRef.current = false
      restoreRef.current = null
    }
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
      // Todos just finished (or the stream ended). A todo panel has nothing to
      // show without active todos, so close it regardless of whether it was
      // auto-opened — otherwise an empty panel lingers after the run.
      if (panelModeRef.current === "todo") {
        const back = autoEngagedRef.current ? restoreRef.current : null
        expectedRef.current = back
        setPanelMode((m) => (m === "todo" ? back : m))
      }
      autoEngagedRef.current = false
      restoreRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
