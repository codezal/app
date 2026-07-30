// Pre-commit / pre-push code review gate (hook).
//
// useCommitReview(workspace) gives a commit surface a single async gate:
//
//   const review = useCommitReview(workspace)
//   …
//   if ((await review.gate("commit")) === "abort") return
//   …perform the commit…
//   {review.dialog}
//
// When review is disabled (default) or no model is available the gate resolves
// "proceed" immediately and renders nothing. When the model returns findings, a
// dialog lists them; critical findings block unless the user overrides. A review
// failure never blocks — it degrades to "proceed". See lib/git-review.ts.
//
// The presentational dialogs live in components/PreCommitReview.tsx so that file
// only exports components (react-refresh); this file only exports the hook.
import { useCallback, useRef, useState, type ReactNode } from "react"
import {
  ReviewingDialog,
  ReviewResultsDialog,
  type GateMode,
  type GateVerdict,
} from "@/components/PreCommitReview"
import { resolveCompactModel } from "@/lib/compact"
import { hasCritical, reviewDiff, type ReviewResult } from "@/lib/git-review"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { buildFixPrompt, pickTargetSession } from "@/lib/review-fix"
import { useT } from "@/lib/i18n/useT"

export type { GateMode, GateVerdict }

type ReviewState =
  | { phase: "reviewing"; mode: GateMode }
  | {
      phase: "results"
      mode: GateMode
      result: ReviewResult
      blocking: boolean
      resolve: (verdict: GateVerdict) => void
    }

export function useCommitReview(workspace: string | undefined): {
  gate: (mode: GateMode) => Promise<GateVerdict>
  dialog: ReactNode
} {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const active = useSessionsStore((s) => s.active)
  const [state, setState] = useState<ReviewState | null>(null)
  const abortedRef = useRef(false)

  const gate = useCallback(
    async (mode: GateMode): Promise<GateVerdict> => {
      const enabled = mode === "commit" ? settings.reviewBeforeCommit : settings.reviewBeforePush
      if (!workspace || enabled !== true || !active) return "proceed"

      const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
      const { provider, model } = resolveCompactModel(
        active.provider,
        active.model,
        undefined,
        catalog,
      )

      abortedRef.current = false
      setState({ phase: "reviewing", mode })
      let result: ReviewResult
      try {
        result = await reviewDiff({
          providerId: provider,
          modelId: model,
          settings,
          workspace,
          mode,
        })
      } catch {
        // A failed review must never block the user's git operation.
        setState(null)
        return "proceed"
      }
      if (abortedRef.current) {
        setState(null)
        return "abort"
      }
      if (result.findings.length === 0) {
        setState(null)
        return "proceed"
      }
      const blocking = hasCritical(result) && settings.reviewBlockOnCritical !== false
      return new Promise<GateVerdict>((resolve) => {
        setState({ phase: "results", mode, result, blocking, resolve })
      })
    },
    [workspace, settings, active],
  )

  const finish = (verdict: GateVerdict) => {
    setState((prev) => {
      if (prev?.phase === "results") prev.resolve(verdict)
      return null
    })
  }

  // Hand the findings to the chat so the model fixes them. The commit is aborted
  // (the gate resolves "abort"); App.tsx listens for the event and runs the
  // prompt in the producing session — or a fresh one when none matches, so an
  // unrelated chat is never touched.
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
    finish("abort")
  }

  const cancelReviewing = () => {
    abortedRef.current = true
    setState(null)
  }

  let dialog: ReactNode = null
  if (state?.phase === "reviewing") {
    dialog = (
      <ReviewingDialog
        title={state.mode === "commit" ? t("codeReview.titleCommit") : t("codeReview.titlePush")}
        onCancel={cancelReviewing}
      />
    )
  } else if (state?.phase === "results") {
    dialog = (
      <ReviewResultsDialog
        mode={state.mode}
        result={state.result}
        blocking={state.blocking}
        onProceed={() => finish("proceed")}
        onAbort={() => finish("abort")}
        onFixWithAI={fixWithAI}
      />
    )
  }

  return { gate, dialog }
}
