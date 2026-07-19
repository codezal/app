import { useCallback, useEffect, useState } from "react"
import {
  gitDiffFile,
  gitDiffFileRef,
  gitDiffUntracked,
  gitShowCommit,
  gitStage,
  gitUnstage,
  gitDiscard,
} from "@/lib/git"
import { parseDiffUri } from "@/lib/diff-uri"
import { emitGitChanged } from "@/lib/git-events"
import { useSessionsStore } from "@/store/sessions"
import { basename } from "@/lib/workspace"
import { DiffView } from "./DiffView"
import { ConfirmDialog } from "./ConfirmDialog"
import { Minus, Plus, RefreshCcw, Undo2 } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { errorMessage } from "@/lib/errors"

type Props = {
  // Tam diff URI (codezal-diff:...).
  uri: string
}

export function DiffViewer({ uri }: Props) {
  const t = useT()
  const workspace = useSessionsStore((s) => s.active?.workspacePath ?? null)
  const closeFile = useSessionsStore((s) => s.closeFile)

  const parsed = parseDiffUri(uri)
  const [staged, setStaged] = useState(parsed?.mode === "staged")
  const [diff, setDiff] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mode = parsed?.mode ?? "worktree"
  const path = parsed?.path ?? ""
  const ref = parsed?.ref ?? null
  const isWorking = mode === "worktree" || mode === "staged" || mode === "untracked"
  const canToggle = mode === "worktree" || mode === "staged"

  const load = useCallback(async () => {
    if (!workspace || !path) return
    setDiff(null)
    let text: string
    if (mode === "branch" && ref) text = await gitDiffFileRef(workspace, ref, path)
    else if (mode === "commit" && ref) text = await gitShowCommit(workspace, ref)
    else if (mode === "untracked") text = await gitDiffUntracked(workspace, path)
    else text = await gitDiffFile(workspace, path, staged)
    setDiff(text || t("gitPanel.diffEmpty"))
  }, [workspace, path, mode, ref, staged, t])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    if (!workspace) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      emitGitChanged()
      after?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const onStage = () =>
    void run(
      () => gitStage(workspace!, [path]),
      () => (canToggle ? setStaged(true) : void load()),
    )
  const onUnstage = () =>
    void run(
      () => gitUnstage(workspace!, [path]),
      () => (canToggle ? setStaged(false) : void load()),
    )
  const onDiscard = () =>
    void run(
      () => gitDiscard(workspace!, path, { untracked: mode === "untracked" }),
      () => closeFile(uri),
    )

  if (!parsed) {
    return <div className="px-4 py-3 text-sm text-codezal-mute">{t("gitPanel.diffEmpty")}</div>
  }

  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-codezal px-3 py-2">
        <span className="truncate text-sm">
          <span className="font-medium text-codezal-text">{basename(path)}</span>
          {dir && <span className="ml-1.5 text-sm text-codezal-mute">{dir}</span>}
        </span>
        {mode === "branch" && ref && (
          <span className="shrink-0 text-sm text-codezal-mute">
            {t("gitPanel.branchVsLabel", { branch: ref.slice(0, 7) })}
          </span>
        )}
        <div className="flex-1" />

        {canToggle && (
          <div className="flex shrink-0 rounded-md border border-codezal text-sm">
            <button
              type="button"
              onClick={() => setStaged(false)}
              className={cn("px-2 py-0.5", !staged ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim")}
            >
              {t("gitPanel.worktreeTab")}
            </button>
            <button
              type="button"
              onClick={() => setStaged(true)}
              className={cn("px-2 py-0.5", staged ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim")}
            >
              {t("gitPanel.stagedTab")}
            </button>
          </div>
        )}

        {isWorking && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onStage}
              disabled={busy}
              title={t("gitPanel.stage")}
              className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-accent disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onUnstage}
              disabled={busy}
              title={t("gitPanel.unstage")}
              className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              disabled={busy}
              title={t("gitPanel.discardChanges")}
              className="rounded p-1 text-codezal-mute hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          title={t("gitPanel.refresh")}
          className="rounded p-1 text-codezal-mute hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-codezal-bg">
        {diff === null ? (
          <div className="px-3 py-2 text-sm text-codezal-mute">…</div>
        ) : (
          <DiffView text={diff} />
        )}
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title={t("gitPanel.discardChanges")}
        message={t("gitPanel.discardConfirm")}
        confirmLabel={t("gitPanel.discardChanges")}
        onConfirm={() => {
          setConfirmDiscard(false)
          onDiscard()
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  )
}
