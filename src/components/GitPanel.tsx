import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight as ChevRight,
  GitBranch,
  Minus,
  MoreVertical,
  Plus,
  RefreshCcw,
  ScrollText,
  Sparkles,
  Undo2,
  X,
} from "@/lib/icons"
import {
  gitBranchDiff,
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitFetch,
  gitLog,
  gitPublish,
  gitPull,
  gitPush,
  gitStage,
  gitStageAll,
  gitStashList,
  gitStashPop,
  gitStashSave,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  statusLabel,
  type GitBranchChange,
  type GitBranchDiff,
  type GitCommitEntry,
  type GitStashEntry,
  type GitStatus,
  type GitStatusEntry,
} from "@/lib/git"
import { makeDiffUri } from "@/lib/diff-uri"
import { makeOutputDoc } from "@/lib/output-doc"
import { emitGitChanged, onGitChanged } from "@/lib/git-events"
import { generateCommitMessage } from "@/lib/git-ai-commit"
import { resolveCompactModel } from "@/lib/compact"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { ConfirmDialog } from "./ConfirmDialog"
import { GitErrorDialog } from "./GitErrorDialog"
import { PRPanel } from "./PRPanel"
import { watchWorkspace } from "@/lib/file-watcher"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import { errorMessage } from "@/lib/errors"

const COMMIT_MAX_PX = 200

type Props = {
  workspacePath?: string
  onClose?: () => void
}

export function GitPanel({ workspacePath, onClose }: Props) {
  const t = useT()
  const [view, setView] = useState<"worktree" | "branch" | "pr">("worktree")
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branch, setBranch] = useState<GitBranchDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const openFile = useSessionsStore((s) => s.openFile)
  const active = useSessionsStore((s) => s.active)
  const settings = useSettingsStore((s) => s.settings)

  const refresh = useCallback(async () => {
    if (!workspacePath || view === "pr") return
    setLoading(true)
    setError(null)
    try {
      if (view === "branch") {
        setBranch(await gitBranchDiff(workspacePath))
      } else {
        setStatus(await gitStatus(workspacePath))
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath, view])

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(id)
  }, [refresh])

  useEffect(() => onGitChanged(() => void refresh()), [refresh])

  const openWorktreeDiff = (e: GitStatusEntry) => {
    const l = statusLabel(e)
    const mode: "untracked" | "worktree" | "staged" =
      l.kind === "untracked"
        ? "untracked"
        : e.worktree !== " " && e.worktree !== "!"
          ? "worktree"
          : "staged"
    openFile(makeDiffUri({ mode, ref: null, path: e.path }))
  }
  const openBranchDiff = (f: GitBranchChange) => {
    if (!branch?.base) return
    openFile(makeDiffUri({ mode: "branch", ref: branch.base, path: f.file }))
  }

  const [message, setMessage] = useState("")
  const commitRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = commitRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, COMMIT_MAX_PX)}px`
    el.style.overflowX = "hidden"
    el.style.overflowY = el.scrollHeight > COMMIT_MAX_PX ? "auto" : "hidden"
  }, [message])
  const [amend, setAmend] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<GitStatusEntry | null>(null)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    if (!workspacePath) return
    setBusy(true)
    setError(null)
    setFailure(null)
    try {
      await fn()
      emitGitChanged()
    } catch (e) {
      setFailure({ title: t("gitPanel.opFailed"), detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const stageOne = (e: GitStatusEntry) => void run(() => gitStage(workspacePath!, [e.path]))
  const unstageOne = (e: GitStatusEntry) => void run(() => gitUnstage(workspacePath!, [e.path]))
  const doDiscardOne = (e: GitStatusEntry) =>
    void run(() =>
      gitDiscard(workspacePath!, e.path, { untracked: statusLabel(e).kind === "untracked" }),
    )
  const stageAll = () => void run(() => gitStageAll(workspacePath!))
  const unstageAll = () => void run(() => gitUnstageAll(workspacePath!))

  const doCommit = async () => {
    if (!workspacePath || (!message.trim() && !amend)) return
    setCommitting(true)
    setError(null)
    setFailure(null)
    try {
      const entries = status?.entries ?? []
      const anyStaged = entries.some(
        (e) => e.index !== " " && e.index !== "?" && e.index !== "!",
      )
      if (!anyStaged && entries.length > 0) await gitStageAll(workspacePath)
      await gitCommit(workspacePath, message, { amend })
      setMessage("")
      setAmend(false)
      emitGitChanged()
    } catch (e) {
      setFailure({ title: t("gitPanel.commitFailed"), detail: errorMessage(e) })
    } finally {
      setCommitting(false)
    }
  }

  const [aiBusy, setAiBusy] = useState(false)
  const onAiCommit = async () => {
    if (!workspacePath || !active) return
    setAiBusy(true)
    setError(null)
    try {
      const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
      const { provider, model } = resolveCompactModel(active.provider, active.model, undefined, catalog)
      const msg = await generateCommitMessage({
        providerId: provider,
        modelId: model,
        settings,
        workspace: workspacePath,
      })
      if (msg) setMessage(msg)
      else setError(t("gitPanel.aiCommitFailed"))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setAiBusy(false)
    }
  }

  const hasChanges = (status?.entries.length ?? 0) > 0
  const canCommit = (message.trim().length > 0 || amend) && (hasChanges || amend) && !committing

  // ── Sync (push / pull / fetch) ───────────────────────────────────────────────
  const doPush = () => void run(() => gitPush(workspacePath!))
  const doPull = () => void run(() => gitPull(workspacePath!))
  const doFetch = () => void run(() => gitFetch(workspacePath!))
  const doSync = () =>
    void run(async () => {
      await gitPull(workspacePath!)
      await gitPush(workspacePath!)
    })
  const doPublish = () => void run(() => gitPublish(workspacePath!))

  const ahead = status?.info.ahead ?? 0
  const behind = status?.info.behind ?? 0
  const hasUpstream = !!status?.info.upstream
  const isWorktreeRepo = view === "worktree" && status?.isRepo !== false
  const needsSync = isWorktreeRepo && !hasChanges && hasUpstream && (ahead > 0 || behind > 0)
  const needsPublish = isWorktreeRepo && !hasChanges && !hasUpstream && !!status?.info.branch

  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<GitCommitEntry[]>([])
  const [stashOpen, setStashOpen] = useState(false)
  const [stashes, setStashes] = useState<GitStashEntry[]>([])

  const doStashSave = () => void run(() => gitStashSave(workspacePath!))
  const doStashPop = (i: number) => void run(() => gitStashPop(workspacePath!, i))
  const openCommit = (hash: string) =>
    openFile(makeDiffUri({ mode: "commit", ref: hash, path: hash.slice(0, 9) }))

  useEffect(() => {
    if (!historyOpen || !workspacePath) return
    let alive = true
    void gitLog(workspacePath, 30).then((h) => {
      if (alive) setHistory(h)
    })
    return () => {
      alive = false
    }
  }, [historyOpen, workspacePath, status])
  useEffect(() => {
    if (!stashOpen || !workspacePath) return
    let alive = true
    void gitStashList(workspacePath).then((s) => {
      if (alive) setStashes(s)
    })
    return () => {
      alive = false
    }
  }, [stashOpen, workspacePath, status])

  useEffect(() => {
    if (!workspacePath) return
    let unwatch: (() => void) | undefined
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 400)
    }
    void watchWorkspace(workspacePath, schedule)
      .then((fn) => {
        if (disposed) fn()
        else unwatch = fn
      })
      .catch(() => {
      })
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unwatch?.()
    }
  }, [workspacePath, refresh])

  if (!workspacePath) {
    return (
      <div className="px-1 py-3 text-sm text-codezal-mute">
        {t("gitPanel.notConnectedHint")}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
      {view !== "pr" && (
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-codezal-dim" />
        <span className="min-w-0 truncate text-sm font-medium text-codezal-dim">
          {(view === "branch" ? branch?.current : status?.info.branch) ??
            (status?.isRepo === false ? t("gitPanel.notRepoLabel") : "…")}
        </span>
        {view === "worktree" && status?.info.upstream && (
          <span className="truncate text-sm text-codezal-mute">
            → {status.info.upstream}
          </span>
        )}
        {view === "branch" && branch?.defaultBranch && (
          <span className="truncate text-sm text-codezal-mute">
            {t("gitPanel.branchVsLabel", { branch: branch.defaultBranch })}
          </span>
        )}
        {view === "worktree" && (ahead > 0 || behind > 0) ? (
          <span className="flex shrink-0 items-center gap-1 text-sm text-codezal-mute">
            {behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3" />
                {behind}
              </span>
            )}
            {ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-3 w-3" />
                {ahead}
              </span>
            )}
          </span>
        ) : null}
        <div className="flex-1" />
        {view === "worktree" && status?.isRepo !== false && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={busy}
              title={t("common.more")}
              className="rounded p-1 text-codezal-mute hover:text-codezal-text disabled:opacity-50"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-44 cz-menu py-1 text-sm">
                  <MenuItem
                    icon={amend ? <Check className="h-4 w-4" /> : undefined}
                    label={t("gitPanel.amend")}
                    onClick={() => {
                      setMenuOpen(false)
                      setAmend((v) => !v)
                    }}
                  />
                  <div className="my-1 border-t border-codezal" />
                  <MenuItem
                    icon={<ArrowDown className="h-4 w-4" />}
                    label={t("gitPanel.pull")}
                    onClick={() => {
                      setMenuOpen(false)
                      doPull()
                    }}
                  />
                  <MenuItem
                    icon={<ArrowUp className="h-4 w-4" />}
                    label={t("gitPanel.push")}
                    onClick={() => {
                      setMenuOpen(false)
                      doPush()
                    }}
                  />
                  <MenuItem
                    icon={<RefreshCcw className="h-4 w-4" />}
                    label={t("gitPanel.sync")}
                    onClick={() => {
                      setMenuOpen(false)
                      doSync()
                    }}
                  />
                  <MenuItem
                    label={t("gitPanel.fetch")}
                    onClick={() => {
                      setMenuOpen(false)
                      doFetch()
                    }}
                  />
                  <div className="my-1 border-t border-codezal" />
                  <MenuItem
                    icon={<ScrollText className="h-4 w-4" />}
                    label={t("gitPanel.commitHistory")}
                    onClick={() => {
                      setMenuOpen(false)
                      setHistoryOpen((v) => !v)
                    }}
                  />
                  <MenuItem
                    label={t("gitPanel.stashSave")}
                    onClick={() => {
                      setMenuOpen(false)
                      doStashSave()
                    }}
                  />
                  <MenuItem
                    label={t("gitPanel.stashList")}
                    onClick={() => {
                      setMenuOpen(false)
                      setStashOpen((v) => !v)
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("gitPanel.refresh")}
          className="rounded p-1 text-codezal-mute hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title={tStatic("contextPanel.panelClose")}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        </div>
      )}
        <div className="flex gap-0.5 rounded-lg bg-codezal-chip-soft p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setView("worktree")}
            className={cn(
              "flex-1 rounded-md px-2 py-1 font-medium transition-colors",
              view === "worktree"
                ? "bg-codezal-panel text-codezal-text shadow-sm"
                : "text-codezal-mute hover:text-codezal-text",
            )}
          >
            {t("gitPanel.viewWorktree")}
          </button>
          <button
            type="button"
            onClick={() => setView("branch")}
            className={cn(
              "flex-1 rounded-md px-2 py-1 font-medium transition-colors",
              view === "branch"
                ? "bg-codezal-panel text-codezal-text shadow-sm"
                : "text-codezal-mute hover:text-codezal-text",
            )}
          >
            {t("gitPanel.viewBranch")}
          </button>
          <button
            type="button"
            onClick={() => setView("pr")}
            className={cn(
              "flex-1 rounded-md px-2 py-1 font-medium transition-colors",
              view === "pr"
                ? "bg-codezal-panel text-codezal-text shadow-sm"
                : "text-codezal-mute hover:text-codezal-text",
            )}
          >
            {t("tabBar.modePr")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {view === "pr" && <PRPanel workspacePath={workspacePath} />}

      {isWorktreeRepo && (hasChanges || amend) && (
        <div className="space-y-1.5">
          <textarea
            ref={commitRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                void doCommit()
              }
            }}
            placeholder={aiBusy ? t("gitPanel.aiGenerating") : t("gitPanel.commitMessage")}
            rows={2}
            className="w-full resize-none overflow-hidden rounded-md border border-codezal bg-codezal-input px-2.5 py-2 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-strong focus:outline-none"
          />
          {amend && (
            <div className="flex items-center justify-between rounded-md bg-codezal-chip-soft px-2 py-1 text-sm uppercase tracking-[0.08em] text-codezal-dim">
              <span>{t("gitPanel.amend")}</span>
              <button
                type="button"
                onClick={() => setAmend(false)}
                title={t("common.close")}
                className="rounded p-0.5 text-codezal-mute hover:text-codezal-text"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void onAiCommit()}
              disabled={aiBusy || committing}
              title={aiBusy ? t("gitPanel.aiGenerating") : t("gitPanel.aiCommit")}
              className="flex shrink-0 items-center justify-center rounded-md border border-codezal px-3 py-1.5 text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/55 disabled:opacity-40"
            >
              {aiBusy ? (
                <RefreshCcw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void doCommit()}
              disabled={!canCommit}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md bg-codezal-text px-2.5 py-1.5 text-sm font-medium text-codezal-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/55 disabled:opacity-40"
            >
              {committing ? (
                <RefreshCcw className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Check className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {committing ? t("gitPanel.committing") : t("gitPanel.commit")}
              </span>
            </button>
          </div>
        </div>
      )}

      {needsSync && (
        <button
          type="button"
          onClick={doSync}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-codezal-text px-2.5 py-1.5 text-sm font-medium text-codezal-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/55 disabled:opacity-40"
        >
          <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
          <span>{t("gitPanel.sync")}</span>
          <span className="flex items-center gap-1 text-sm opacity-80">
            {behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3" />
                {behind}
              </span>
            )}
            {ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-3 w-3" />
                {ahead}
              </span>
            )}
          </span>
        </button>
      )}
      {needsPublish && (
        <button
          type="button"
          onClick={doPublish}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-codezal-text px-2.5 py-1.5 text-sm font-medium text-codezal-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/55 disabled:opacity-40"
        >
          {busy ? (
            <RefreshCcw className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
          <span>{t("gitPanel.push")}</span>
        </button>
      )}

      {view === "pr" ? null : view === "branch" ? (
        branch == null ? null : branch.defaultBranch == null ? (
          <div className="px-1 py-2 text-sm text-codezal-mute">
            {t("gitPanel.branchNoDefault")}
          </div>
        ) : branch.onDefault ? (
          <div className="px-1 py-2 text-sm text-codezal-mute">
            {t("gitPanel.branchOnDefault")}
          </div>
        ) : branch.files.length === 0 ? (
          <div className="px-1 py-2 text-sm text-codezal-mute">
            {t("gitPanel.branchNoChanges", { branch: branch.defaultBranch })}
          </div>
        ) : (
          <BranchFileList files={branch.files} onPick={openBranchDiff} />
        )
      ) : status?.isRepo === false ? (
        <div className="px-1 py-2 text-sm text-codezal-mute">
          {t("gitPanel.notARepoHint", { gitinit: "git init" })}
        </div>
      ) : status?.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Check className="h-7 w-7 text-codezal-mute" />
          <div className="text-md text-codezal-dim">{t("gitPanel.cleanWorktree")}</div>
        </div>
      ) : status ? (
        <FileGroups
          entries={status.entries}
          busy={busy}
          onPick={openWorktreeDiff}
          onStage={stageOne}
          onUnstage={unstageOne}
          onDiscard={(e) => setConfirmDiscard(e)}
          onStageAll={stageAll}
          onUnstageAll={unstageAll}
          onDiscardAll={() => setConfirmDiscardAll(true)}
        />
      ) : null}

      {historyOpen && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-codezal-mute">
            <ScrollText className="h-3.5 w-3.5" />
            <span>{t("gitPanel.commitHistory")}</span>
          </div>
          {history.length === 0 ? (
            <div className="px-2 py-1 text-sm text-codezal-mute">{t("gitPanel.noCommits")}</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {history.map((c) => (
                <button
                  key={c.hash}
                  type="button"
                  onClick={() => openCommit(c.hash)}
                  title={c.subject}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-codezal-panel-2"
                >
                  <span className="shrink-0 font-mono text-sm text-codezal-dim">{c.hash.slice(0, 7)}</span>
                  <span className="min-w-0 flex-1 truncate text-codezal-text">{c.subject}</span>
                  <span className="shrink-0 text-sm text-codezal-mute">{c.relDate}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {stashOpen && (
        <div>
          <div className="mb-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-codezal-mute">
            {t("gitPanel.stashList")}
          </div>
          {stashes.length === 0 ? (
            <div className="px-2 py-1 text-sm text-codezal-mute">{t("gitPanel.noStashes")}</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {stashes.map((s) => (
                <div
                  key={s.index}
                  className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-codezal-panel-2"
                >
                  <span className="min-w-0 flex-1 truncate text-codezal-text" title={s.label}>
                    {s.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => doStashPop(s.index)}
                    disabled={busy}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-codezal-dim hover:bg-codezal-chip hover:text-codezal-text disabled:opacity-40"
                  >
                    {t("gitPanel.stashPop")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDiscard !== null}
        title={t("gitPanel.discardChanges")}
        message={t("gitPanel.discardConfirm")}
        confirmLabel={t("gitPanel.discardChanges")}
        onConfirm={() => {
          const e = confirmDiscard
          setConfirmDiscard(null)
          if (e) doDiscardOne(e)
        }}
        onCancel={() => setConfirmDiscard(null)}
      />
      <ConfirmDialog
        open={confirmDiscardAll}
        title={t("gitPanel.discardAll")}
        message={t("gitPanel.discardAllConfirm")}
        confirmLabel={t("gitPanel.discardAll")}
        onConfirm={() => {
          setConfirmDiscardAll(false)
          void run(() => gitDiscardAll(workspacePath!))
        }}
        onCancel={() => setConfirmDiscardAll(false)}
      />
      <GitErrorDialog
        open={failure !== null}
        title={failure?.title ?? ""}
        detail={failure?.detail ?? ""}
        onShowOutput={() => {
          if (failure) openFile(makeOutputDoc(failure.title, failure.detail))
          setFailure(null)
        }}
        onClose={() => setFailure(null)}
      />
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-codezal-text hover:bg-codezal-panel-2"
    >
      <span className="flex h-4 w-4 items-center justify-center text-codezal-mute">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function FileGroups({
  entries,
  busy,
  onPick,
  onStage,
  onUnstage,
  onDiscard,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
}: {
  entries: GitStatusEntry[]
  busy: boolean
  onPick: (e: GitStatusEntry) => void
  onStage: (e: GitStatusEntry) => void
  onUnstage: (e: GitStatusEntry) => void
  onDiscard: (e: GitStatusEntry) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onDiscardAll: () => void
}) {
  const staged = entries.filter((e) => e.index !== " " && e.index !== "?" && e.index !== "!")
  const unstaged = entries.filter(
    (e) => (e.worktree !== " " && e.worktree !== "!") || e.index === "?",
  )

  return (
    <div className="space-y-3">
      {staged.length > 0 && (
        <Group
          label={tStatic("gitPanel.stagedLabel")}
          count={staged.length}
          actions={
            <IconAction title={tStatic("gitPanel.unstageAll")} onClick={onUnstageAll} disabled={busy}>
              <Minus className="h-3.5 w-3.5" />
            </IconAction>
          }
        >
          {staged.map((e) => (
            <FileRow
              key={"s" + e.path}
              entry={e}
              busy={busy}
              onClick={() => onPick(e)}
              onUnstage={() => onUnstage(e)}
            />
          ))}
        </Group>
      )}
      {unstaged.length > 0 && (
        <Group
          label={tStatic("gitPanel.modifiedLabel")}
          count={unstaged.length}
          actions={
            <>
              <IconAction title={tStatic("gitPanel.discardAll")} onClick={onDiscardAll} disabled={busy} danger>
                <Undo2 className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction title={tStatic("gitPanel.stageAll")} onClick={onStageAll} disabled={busy}>
                <Plus className="h-3.5 w-3.5" />
              </IconAction>
            </>
          }
        >
          {unstaged.map((e) => (
            <FileRow
              key={"u" + e.path}
              entry={e}
              busy={busy}
              onClick={() => onPick(e)}
              onStage={() => onStage(e)}
              onDiscard={() => onDiscard(e)}
            />
          ))}
        </Group>
      )}
    </div>
  )
}

function IconAction({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/55 disabled:opacity-40",
        danger ? "hover:text-destructive" : "hover:text-codezal-text",
      )}
    >
      {children}
    </button>
  )
}

function Group({
  label,
  count,
  actions,
  children,
}: {
  label: string
  count: number
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <div className="group mb-1.5 flex w-full items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-codezal-mute">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-codezal-mute" />
          ) : (
            <ChevRight className="h-3.5 w-3.5 text-codezal-mute" />
          )}
          <span>{label}</span>
          <span className="rounded bg-codezal-chip-soft px-1.5 text-sm font-medium text-codezal-mute">
            {count}
          </span>
        </button>
        {actions && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  )
}

function FileRow({
  entry,
  busy,
  onClick,
  onStage,
  onUnstage,
  onDiscard,
}: {
  entry: GitStatusEntry
  busy?: boolean
  onClick: () => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
}) {
  const l = statusLabel(entry)
  const color = l.kind === "add"
    ? "text-codezal-diff-add"
    : l.kind === "del"
    ? "text-codezal-diff-del"
    : l.kind === "untracked"
    ? "text-codezal-diff-add"
    : l.kind === "conflict"
    ? "text-codezal-diff-del"
    : "text-codezal-dim"
  const slash = entry.path.lastIndexOf("/")
  const base = slash >= 0 ? entry.path.slice(slash + 1) : entry.path
  const dir = slash >= 0 ? entry.path.slice(0, slash) : ""
  const letter = l.kind === "untracked" ? "U" : l.code.trim() || "•"
  return (
    <div className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-codezal-panel-2">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={entry.path}
      >
        <span className="min-w-0 truncate text-codezal-text">{base}</span>
        {dir && (
          <span className="ml-auto max-w-[55%] shrink-0 truncate pl-2 text-sm text-codezal-mute">
            {dir}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {onDiscard && (
          <IconAction title={tStatic("gitPanel.discardChanges")} onClick={onDiscard} disabled={busy} danger>
            <Undo2 className="h-3.5 w-3.5" />
          </IconAction>
        )}
        {onStage && (
          <IconAction title={tStatic("gitPanel.stage")} onClick={onStage} disabled={busy}>
            <Plus className="h-3.5 w-3.5" />
          </IconAction>
        )}
        {onUnstage && (
          <IconAction title={tStatic("gitPanel.unstage")} onClick={onUnstage} disabled={busy}>
            <Minus className="h-3.5 w-3.5" />
          </IconAction>
        )}
      </div>
      <span className={cn("w-4 shrink-0 text-center font-mono text-sm font-semibold", color)}>
        {letter}
      </span>
    </div>
  )
}

function BranchFileList({
  files,
  onPick,
}: {
  files: GitBranchChange[]
  onPick: (f: GitBranchChange) => void
}) {
  return (
    <div className="space-y-3">
      <Group label={tStatic("gitPanel.viewBranch")} count={files.length}>
        {files.map((f) => (
          <BranchFileRow key={f.file} change={f} onClick={() => onPick(f)} />
        ))}
      </Group>
    </div>
  )
}

function BranchFileRow({
  change,
  onClick,
}: {
  change: GitBranchChange
  onClick: () => void
}) {
  const code = change.status === "added" ? "A" : change.status === "deleted" ? "D" : "M"
  const color =
    change.status === "added"
      ? "text-codezal-diff-add"
      : change.status === "deleted"
      ? "text-codezal-diff-del"
      : "text-codezal-dim"
  const slash = change.file.lastIndexOf("/")
  const base = slash >= 0 ? change.file.slice(slash + 1) : change.file
  const dir = slash >= 0 ? change.file.slice(0, slash) : ""
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-codezal-panel-2"
      title={change.file}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-codezal-text">{base}</span>
        {dir && (
          <span className="ml-auto max-w-[55%] shrink-0 truncate pl-2 text-sm text-codezal-mute">
            {dir}
          </span>
        )}
      </span>
      {change.additions > 0 && (
        <span className="shrink-0 font-mono text-sm text-codezal-diff-add">+{change.additions}</span>
      )}
      {change.deletions > 0 && (
        <span className="shrink-0 font-mono text-sm text-codezal-diff-del">-{change.deletions}</span>
      )}
      <span className={cn("w-4 shrink-0 text-center font-mono text-sm font-semibold", color)}>{code}</span>
    </button>
  )
}
