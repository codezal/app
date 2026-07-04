import { useEffect } from "react"
import { useSessionsStore } from "@/store/sessions"
import { resolveSessionDefaults } from "@/lib/session-defaults"
import type { Settings } from "@/store/types"

//
export function useBootDraft(settings: Settings, settingsLoaded: boolean) {
  const sessionsLoaded = useSessionsStore((s) => s.loaded)
  const createDraft = useSessionsStore((s) => s.createDraft)

  useEffect(() => {
    if (!settingsLoaded || !sessionsLoaded) return
    if (useSessionsStore.getState().active) return
    const d = resolveSessionDefaults(undefined, settings)
    createDraft(d.provider, d.model, undefined, settings.reasoningEffort)
  }, [settingsLoaded, sessionsLoaded, createDraft, settings])
}
