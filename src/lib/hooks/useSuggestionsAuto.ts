// Post-run trigger for next-step suggestions. Mirrors useTodoPanelAuto's edge
// detection: when the active session's stream goes true→false (a run finished)
// and the setting is on, generate suggestions for that session and surface the
// right panel once items arrive. Foreground-only, single-flight (store-guarded).
import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import type { ModelMessage } from "ai"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { useSuggestionsStore } from "@/store/suggestions"
import type { PanelMode } from "@/components/TabBar"
import type { ProvidersCatalog } from "@/lib/providers-catalog"

// Short, token-bounded transcript tail from the session's model messages — plain
// text grounding for the cheap suggestion model. Tool parts (no text) collapse to "".
function renderTail(msgs: ModelMessage[], maxMsgs = 6, perMsg = 600): string {
  return msgs
    .slice(-maxMsgs)
    .map((m) => {
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) =>
                  p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : "",
                )
                .join(" ")
            : ""
      return `${m.role}: ${text.slice(0, perMsg)}`
    })
    .join("\n")
}

// Build context from a session and kick off generation. Shared by the auto-trigger
// and the panel's manual "Refresh". No-op unless the session had a real exchange.
// Store-level single-flight prevents overlapping runs.
export async function triggerSuggestionsFor(sid: string | null | undefined): Promise<void> {
  if (!sid) return
  const settings = useSettingsStore.getState().settings
  // Gate here too (not only in the auto-hook) so the panel's manual Refresh path
  // also respects the setting when it's turned off.
  if (!(settings.suggestionsEnabled ?? true)) return
  const sess = useSessionsStore.getState().sessions[sid]
  if (!sess) return
  if ((sess.messages?.length ?? 0) < 2) return

  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const todos = sess.todos?.length
    ? sess.todos.map((td) => `[${td.status}] ${td.content}`).join("\n")
    : undefined

  await useSuggestionsStore.getState().generateFor(sid, {
    providerId: sess.provider,
    modelId: sess.model,
    settings,
    workspace: sess.workspacePath,
    catalog,
    recentMessages: renderTail(sess.modelMessages ?? []),
    goal: sess.goal?.text,
    todos,
  })
}

export function useSuggestionsAuto(
  activeStreaming: boolean,
  setPanelMode: Dispatch<SetStateAction<PanelMode | null>>,
) {
  const enabled = useSettingsStore((s) => s.settings.suggestionsEnabled ?? true)
  const prevStreamingRef = useRef(activeStreaming)

  useEffect(() => {
    const was = prevStreamingRef.current
    prevStreamingRef.current = activeStreaming
    // Only fire on the true→false edge (a foreground run just finished).
    if (!was || activeStreaming) return
    if (!enabled) return

    const sid = useSessionsStore.getState().activeId
    void triggerSuggestionsFor(sid).then(() => {
      // Surface the panel only if we got suggestions, the user is still on this
      // session, AND no new run has started since — otherwise we'd yank the todo
      // panel (useTodoPanelAuto) away mid-run.
      const st = useSessionsStore.getState()
      const e = sid ? useSuggestionsStore.getState().bySession[sid] : undefined
      if (e && e.items.length > 0 && sid && st.activeId === sid && !st.streamingIds[sid]) {
        setPanelMode("suggestions")
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStreaming])
}
