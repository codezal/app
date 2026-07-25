// Status-bar commit affordance: shows the workspace's uncommitted-change count
// (and ahead count) and opens a one-line commit flow — stage-all + commit, with
// an optional AI-written message, plus a single "Commit & push" action. Mirrors
// the write → review → ship loop of dedicated git IDEs, kept on one row.
import { useEffect, useRef, useState } from "react"
import { FilePen, GitCommitHorizontal, Loader2, Sparkles, Upload } from "@/lib/icons"
import {
  gitCommit,
  gitPublish,
  gitPush,
  gitStageAll,
  gitStatus,
  type GitStatus,
} from "@/lib/git"
import { emitGitChanged, onGitChanged } from "@/lib/git-events"
import { generateCommitMessage } from "@/lib/git-ai-commit"
import type { ProviderId } from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { toast } from "@/store/toast"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { useCommitReview } from "@/lib/use-commit-review"

type Props = {
  workspace: string
  providerId?: ProviderId
  modelId?: string
}

export function CommitBar({ workspace, providerId, modelId }: Props) {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const review = useCommitReview(workspace)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      gitStatus(workspace)
        .then((s) => {
          if (alive) setStatus(s)
        })
        .catch(() => {})
    }
    load()
    const off = onGitChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [workspace])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  if (!status?.isRepo) return null
  const changes = status.entries.length
  const ahead = status.info.ahead
  if (changes === 0 && ahead === 0) return null
  const hasChanges = changes > 0

  async function fillAi() {
    if (!providerId || !modelId) {
      toast.error(t("statusBar.commitAiNeedsModel"))
      return
    }
    setAiBusy(true)
    try {
      const msg = await generateCommitMessage({ providerId, modelId, settings, workspace })
      if (msg) setMessage(msg)
      else toast.error(t("statusBar.commitAiEmpty"))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAiBusy(false)
    }
  }

  async function run(opts: { commit: boolean; push: boolean }) {
    const doCommit = opts.commit && hasChanges
    const doPush = opts.push
    if (!doCommit && !doPush) return
    const msg = message.trim()
    if (doCommit && !msg) {
      toast.error(t("statusBar.commitEmptyMessage"))
      return
    }
    setBusy(true)
    try {
      if (doCommit) {
        await gitStageAll(workspace)
        // Pre-commit review gate (opt-in); abort leaves staged changes intact.
        if ((await review.gate("commit")) === "abort") return
        await gitCommit(workspace, msg)
      }
      if (doPush) {
        // Pre-push review gate (opt-in) over the commits about to be pushed.
        if ((await review.gate("push")) === "abort") return
        try {
          await gitPush(workspace)
        } catch {
          await gitPublish(workspace)
        }
      }
      setOpen(false)
      setMessage("")
      toast.success(
        doCommit && doPush
          ? t("statusBar.commitPushed")
          : doPush
            ? t("statusBar.pushOnlyDone")
            : t("statusBar.commitCommitted"),
      )
      emitGitChanged()
      setStatus(await gitStatus(workspace))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("statusBar.commitTitle")}
        aria-label={t("statusBar.commitTitle")}
        className={cn(
          "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
          hasChanges
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/50 hover:bg-emerald-500/20 dark:text-emerald-400"
            : "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:border-sky-500/50 hover:bg-sky-500/20 dark:text-sky-400",
        )}
      >
        {hasChanges ? (
          <FilePen className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Upload className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="tabular-nums font-semibold leading-none">
          {hasChanges ? changes : ahead}
        </span>
        <span className="font-normal leading-none opacity-70">
          {hasChanges ? t("statusBar.changesLabel") : t("statusBar.aheadLabel")}
        </span>
        {hasChanges && ahead > 0 && (
          <span className="ml-0.5 flex items-center gap-0.5 border-l border-emerald-500/30 pl-1.5 tabular-nums font-semibold leading-none opacity-80">
            <Upload className="h-3 w-3" aria-hidden />
            {ahead}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-[30px] left-0 z-50 w-[320px] cz-menu p-2">
          {hasChanges ? (
            <>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("statusBar.commitMessagePlaceholder")}
                rows={2}
                className="mb-1.5 min-h-[52px] w-full resize-none rounded-md border border-codezal-hair bg-codezal-bg px-2 py-1.5 text-sm text-codezal-text outline-none placeholder:text-codezal-mute focus:border-codezal-accent/50"
              />
              <button
                type="button"
                onClick={() => void fillAi()}
                disabled={aiBusy || busy}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-codezal-hair px-2 py-1 text-xs font-medium text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-50"
              >
                {aiBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {aiBusy ? t("statusBar.commitAiWorking") : t("statusBar.commitAi")}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void run({ commit: true, push: false })}
                  disabled={busy || aiBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-codezal-hair px-2 py-1.5 text-xs font-medium text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-50"
                >
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  {t("statusBar.commitBtn")}
                </button>
                <button
                  type="button"
                  onClick={() => void run({ commit: true, push: true })}
                  disabled={busy || aiBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-codezal-accent/40 bg-codezal-accent/10 px-2 py-1.5 text-xs font-semibold text-codezal-accent transition-colors hover:bg-codezal-accent/20 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t("statusBar.commitAndPush")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void run({ commit: false, push: true })}
                disabled={busy || aiBusy || ahead === 0}
                title={ahead === 0 ? t("statusBar.pushNoAhead") : undefined}
                aria-label={t("statusBar.pushOnly")}
                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-codezal-hair px-2 py-1.5 text-xs font-medium text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {t("statusBar.pushOnly")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void run({ commit: false, push: true })}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-codezal-accent/40 bg-codezal-accent/10 px-2 py-1.5 text-xs font-semibold text-codezal-accent transition-colors hover:bg-codezal-accent/20 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("statusBar.commitPush", { n: ahead })}
            </button>
          )}
        </div>
      )}
      {review.dialog}
    </div>
  )
}
