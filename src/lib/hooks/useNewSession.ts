import { useCallback } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useSessionsStore } from "@/store/sessions"
import { resolveSessionDefaults } from "@/lib/session-defaults"
import type { PanelMode } from "@/components/TabBar"
import type { Settings } from "@/store/types"

//
export function useNewSession(
  settings: Settings,
  setPanelMode: Dispatch<SetStateAction<PanelMode | null>>,
) {
  const create = useSessionsStore((s) => s.create)
  const createDraft = useSessionsStore((s) => s.createDraft)
  const lastSessionContext = useSessionsStore((s) => s.lastSessionContext)

  return useCallback(
    async (persist: boolean) => {
      const ctx = await lastSessionContext({
        provider: settings.defaultProvider,
        model: settings.defaultModel,
        reasoningEffort: settings.reasoningEffort,
      })
      const pm = useSessionsStore.getState().projectMeta
      const d = resolveSessionDefaults(ctx.workspacePath ? pm[ctx.workspacePath] : undefined, settings)
      if (persist) await create(d.provider, d.model, ctx.workspacePath, ctx.reasoningEffort)
      else createDraft(d.provider, d.model, ctx.workspacePath, ctx.reasoningEffort)
      setPanelMode(ctx.workspacePath && settings.openFilesPanelOnLaunch !== false ? "files" : null)
    },
    [settings, create, createDraft, lastSessionContext, setPanelMode],
  )
}
