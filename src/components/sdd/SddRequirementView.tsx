import { useEffect } from "react"
import { Check, FileText, Globe, ImageIcon, ListChecks, Palette, Play, Search, Sparkles } from "@/lib/icons"
import { sddPlanPath, sddRequirementPath } from "@/lib/sdd-store"
import { useSddStore } from "@/store/sdd"
import { useSessionsStore } from "@/store/sessions"
import { FileViewer } from "@/components/FileViewer"
import { SddStepper } from "./SddStepper"
import { useSddDocSync } from "./useSddDocSync"
import { useT } from "@/lib/i18n/useT"
import type { MessageKey } from "@/lib/i18n/types-messages"
import type { SddStage } from "@/store/types"

const ORDER: SddStage[] = ["requirement", "design", "prototype", "plan", "build"]

type QuickAction = { key: string; label: MessageKey; prompt: MessageKey; Icon: typeof Sparkles }
const VERIFY_ACTION: QuickAction = {
  key: "verify",
  label: "sdd.action.verify",
  prompt: "sdd.prompt.verify",
  Icon: Check,
}
const STAGE_ACTIONS: Partial<Record<SddStage, QuickAction[]>> = {
  requirement: [
    { key: "clarify", label: "sdd.action.clarify", prompt: "sdd.prompt.clarify", Icon: Sparkles },
    { key: "research", label: "sdd.action.research", prompt: "sdd.prompt.research", Icon: Search },
    { key: "structure", label: "sdd.action.structure", prompt: "sdd.prompt.structure", Icon: FileText },
  ],
  design: [
    { key: "design", label: "sdd.action.design", prompt: "sdd.prompt.design", Icon: ImageIcon },
    { key: "scene", label: "sdd.action.scene", prompt: "sdd.prompt.scene", Icon: Palette },
  ],
  prototype: [
    { key: "prototype", label: "sdd.action.prototype", prompt: "sdd.prompt.prototype", Icon: Globe },
  ],
  plan: [
    { key: "plan", label: "sdd.action.plan", prompt: "sdd.prompt.plan", Icon: ListChecks },
  ],
  build: [VERIFY_ACTION],
  verify: [VERIFY_ACTION],
}

export function SddRequirementView({
  onSend,
  onClose,
  onOpenPreview,
  onBuild,
}: {
  onSend?: (text: string) => void
  onClose?: () => void
  onOpenPreview?: (absPath: string) => void
  onBuild?: (draftId: string, planPath: string) => void
}) {
  const t = useT()
  const activeId = useSessionsStore((s) => s.activeId)
  const ws = useSessionsStore((s) => (s.activeId ? s.sessions[s.activeId]?.workspacePath : undefined))
  const drafts = useSddStore((s) => s.drafts)
  const loadDrafts = useSddStore((s) => s.loadDrafts)
  const setStage = useSddStore((s) => s.setStage)

  const draft = Object.values(drafts).find((d) => d.assistantSessionId === activeId)
  const reqPath = draft ? sddRequirementPath(draft.workspacePath, draft.id) : null
  const planPath = draft ? sddPlanPath(draft.workspacePath, draft.id) : null

  const { reloadKey, planExists, requestPreviewOnNextTurn } = useSddDocSync({
    draftId: draft?.id,
    draftWorkspace: draft?.workspacePath,
    draftStage: draft?.stage,
    reqPath,
    planPath,
    linkedSid: draft?.assistantSessionId,
    onOpenPreview,
  })

  useEffect(() => {
    if (!draft && ws) void loadDrafts(ws)
  }, [draft, ws, loadDrafts])

  if (!draft || !reqPath) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-codezal-mute">
        {t("sdd.notFound")}
      </div>
    )
  }

  const advance = (): void => {
    const i = ORDER.indexOf(draft.stage === "verify" ? "build" : draft.stage)
    const nx = ORDER[Math.min(ORDER.length - 1, i + 1)]
    if (nx) setStage(draft.id, nx)
  }

  const actions = STAGE_ACTIONS[draft.stage] ?? []

  const showPlan = planExists && (draft.stage === "plan" || draft.stage === "build")
  const docPath = showPlan && planPath ? planPath : reqPath

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SddStepper
        stage={draft.stage}
        onAdvance={draft.stage === "plan" ? undefined : advance}
        onClose={onClose}
      />
      {onSend && actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-codezal-hair bg-codezal-bg px-3 py-1.5">
          {actions.map(({ key, label, prompt, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === "prototype") requestPreviewOnNextTurn()
                if (key === "verify") setStage(draft.id, "verify")
                onSend(t(prompt))
              }}
              className="flex items-center gap-1.5 rounded-md border border-codezal-hair bg-codezal-panel px-2.5 py-1 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
            >
              <Icon className="h-3.5 w-3.5 text-codezal-accent" />
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {onBuild && planExists && planPath && (draft.stage === "plan" || draft.stage === "build") && (
        <div className="border-b border-codezal-hair bg-codezal-bg px-3 py-2">
          <button
            type="button"
            onClick={() => onBuild(draft.id, planPath)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-codezal-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Play className="h-4 w-4" />
            {t("sdd.action.build")}
          </button>
        </div>
      )}
      <FileViewer reloadSignal={reloadKey} path={docPath} />
    </div>
  )
}
