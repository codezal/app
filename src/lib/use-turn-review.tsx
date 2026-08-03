// Post-turn code review hook.
//
// useTurnReview(workspace) gives the turn-diff surface an on-demand model review
// of the working-tree diff — the interactive counterpart to the pre-commit gate
// in use-commit-review.tsx. Unlike that gate it blocks nothing: it is purely
// informational, so there is no proceed/abort promise, just "show findings".
//
//   const review = useTurnReview(workspace)
//   …
//   <button onClick={() => void review.reviewNow()}>Review changes</button>
//   {review.dialog}
//
// A failed review degrades silently (never errors on the user); an empty result
// surfaces a "no issues" toast instead of an empty dialog. Reuses the engine
// (lib/git-review.ts), the dialogs (components/PreCommitReview.tsx) and the
// "Fix with AI" routing (lib/review-fix.ts) so behavior matches the commit gate.

import { useCallback, useRef, useState, type ReactNode } from "react"
import { ReviewingDialog, ReviewResultsDialog } from "@/components/PreCommitReview"
import { resolveCompactModel } from "@/lib/compact"
import { reviewDiff, type ReviewResult } from "@/lib/git-review"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { buildFixPrompt, pickTargetSession } from "@/lib/review-fix"
import { useT } from "@/lib/i18n/useT"
import { toast } from "@/store/toast"

type TurnReviewState = { phase: "reviewing" } | { phase: "results"; result: ReviewResult }

export function useTurnReview(workspace: string | undefined): {
  reviewNow: () => Promise<void>
  reviewing: boolean
  dialog: ReactNode
} {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const active = useSessionsStore((s) => s.active)
  const [state, setState] = useState<TurnReviewState | null>(null)
  const abortedRef = useRef(false)

  const reviewNow = useCallback(async () => {
    if (!workspace || !active) return
    const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
    const { provider, model } = resolveCompactModel(active.provider, active.model, undefined, catalog)

    abortedRef.current = false
    setState({ phase: "reviewing" })
    let result: ReviewResult
    try {
      result = await reviewDiff({
        providerId: provider,
        modelId: model,
        settings,
        workspace,
        mode: "worktree",
      })
    } catch {
      // A failed review must never surface an error to the user.
      setState(null)
      return
    }
    if (abortedRef.current) {
      setState(null)
      return
    }
    if (result.findings.length === 0) {
      setState(null)
      toast.success(t("codeReview.noIssues"))
      return
    }
    setState({ phase: "results", result })
  }, [workspace, settings, active, t])

  // Hand the findings to the chat so the model fixes them — identical routing to
  // the commit gate: App.tsx listens for the event and runs the prompt in the
  // session that produced the change (or a fresh one when none matches).
  const fixWithAI = () => {
    if (state?.phase !== "results") return
    const { result } = state
    const changedFiles = Array.from(
      new Set([
        ...(result.files ?? []),
        ...result.findings.map((f) => f.file).filter((x): x is string => !!x),
      ]),
    )
    const targetId = pickTargetSession(
      useSessionsStore.getState().sessions,
      workspace ?? "",
      changedFiles,
    )
    window.dispatchEvent(
      new CustomEvent("codezal:fix-review-findings", {
        detail: { prompt: buildFixPrompt(result), targetSessionId: targetId, workspace },
      }),
    )
    setState(null)
  }

  let dialog: ReactNode = null
  if (state?.phase === "reviewing") {
    dialog = (
      <ReviewingDialog
        title={t("codeReview.titleTurn")}
        onCancel={() => {
          abortedRef.current = true
          setState(null)
        }}
      />
    )
  } else if (state?.phase === "results") {
    dialog = (
      <ReviewResultsDialog
        mode="turn"
        result={state.result}
        blocking={false}
        onProceed={() => setState(null)}
        onAbort={() => setState(null)}
        onFixWithAI={fixWithAI}
      />
    )
  }

  return { reviewNow, reviewing: state?.phase === "reviewing", dialog }
}
