import { useRef, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ArrowUp, ChevronDown, GitBranch, GitPullRequest, Loader2, X } from "@/lib/icons"
import {
  gitCommit,
  gitCreateBranch,
  gitDefaultBranch,
  gitPublish,
  gitPush,
  gitStageAll,
  gitStatus,
} from "@/lib/git"
import { createPullRequest, getGithubToken, resolveRepo } from "@/lib/github"
import { emitGitChanged } from "@/lib/git-events"
import { errorMessage } from "@/lib/errors"
import { useT } from "@/lib/i18n/useT"
import { useMenu } from "@/lib/useMenu"
import { toast } from "@/store/toast"
import { Dialog } from "./Dialog"

type Action = "branch-commit-push" | "commit-push" | "commit" | "commit-pr"

function upperFirst(value: string): string {
  return value ? value[0].toLocaleUpperCase() + value.slice(1) : value
}

export function TurnReviewActions({
  workspacePath,
  suggestedTitle,
}: {
  workspacePath?: string
  suggestedTitle: string
}) {
  const t = useT()
  const {
    open: menuOpen,
    close: closeMenu,
    wrapRef,
    triggerProps,
    menuProps,
  } = useMenu()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState("")
  const [branchName, setBranchName] = useState("")
  const [prTitle, setPrTitle] = useState("")
  const [prBase, setPrBase] = useState("main")

  const createLabel = upperFirst(t("branchPicker.createBtn"))
  const commitPushLabel = `${t("gitPanel.commit")} & ${t("gitPanel.push")}`
  const actionLabels: Record<Action, string> = {
    "branch-commit-push": `${createLabel} ${t("gitPanel.branch")}, ${commitPushLabel}`,
    "commit-push": commitPushLabel,
    commit: t("gitPanel.commit"),
    "commit-pr": `${t("gitPanel.commit")} & ${createLabel} PR`,
  }

  function openAction(nextAction: Action) {
    closeMenu()
    setCommitMessage("")
    setBranchName("")
    setPrTitle(suggestedTitle)
    setPrBase("main")
    setAction(nextAction)
    if (nextAction === "commit-pr" && workspacePath) {
      void gitDefaultBranch(workspacePath).then((branch) => {
        if (branch) setPrBase(branch)
      })
    }
  }

  async function stageAndCommit() {
    if (!workspacePath) return
    const status = await gitStatus(workspacePath)
    if (!status.isRepo) throw new Error(t("gitPanel.notARepoHint", { gitinit: "git init" }))
    if (status.entries.length === 0) throw new Error(t("gitPanel.noChanges"))
    const anyStaged = status.entries.some(
      (entry) => entry.index !== " " && entry.index !== "?" && entry.index !== "!",
    )
    if (!anyStaged) await gitStageAll(workspacePath)
    await gitCommit(workspacePath, commitMessage.trim())
  }

  async function pushCurrentBranch() {
    if (!workspacePath) return
    const status = await gitStatus(workspacePath)
    if (status.info.upstream) await gitPush(workspacePath)
    else await gitPublish(workspacePath)
  }

  async function runAction() {
    if (!workspacePath || !action || !commitMessage.trim()) return
    setBusy(true)
    try {
      const initialStatus = await gitStatus(workspacePath)
      if (!initialStatus.isRepo) {
        throw new Error(t("gitPanel.notARepoHint", { gitinit: "git init" }))
      }

      let prContext: Awaited<ReturnType<typeof resolveRepo>> | null = null
      let token: string | null = null
      if (action === "commit-pr") {
        if (!initialStatus.info.branch || initialStatus.info.branch === prBase.trim()) {
          throw new Error(t("gitPanel.branchOnDefault"))
        }
        ;[prContext, token] = await Promise.all([resolveRepo(workspacePath), getGithubToken()])
        if (!prContext) throw new Error(t("prPanel.noRemoteTitle"))
        if (!token) throw new Error(t("prPanel.connectTitle"))
      }

      if (action === "branch-commit-push") {
        await gitCreateBranch(workspacePath, branchName.trim())
      }

      await stageAndCommit()

      if (action === "commit-push" || action === "branch-commit-push") {
        await pushCurrentBranch()
      } else if (action === "commit-pr" && prContext && token) {
        await gitPublish(workspacePath)
        const status = await gitStatus(workspacePath)
        if (!status.info.branch) throw new Error(t("gitPanel.branchOnDefault"))
        const pr = await createPullRequest(token, prContext, {
          title: prTitle.trim(),
          head: status.info.branch,
          base: prBase.trim(),
        })
        toast.success(`PR #${pr.number}`)
        if (pr.htmlUrl) void openUrl(pr.htmlUrl).catch(() => {})
      }

      emitGitChanged()
      setAction(null)
      if (action !== "commit-pr") toast.success(actionLabels[action])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const actionReady =
    Boolean(commitMessage.trim()) &&
    (action !== "branch-commit-push" || Boolean(branchName.trim())) &&
    (action !== "commit-pr" || Boolean(prTitle.trim() && prBase.trim()))

  return (
    <>
      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          {...triggerProps}
          disabled={!workspacePath || busy}
          className="flex items-center gap-1.5 rounded-md bg-codezal-text px-2.5 py-1 text-xs font-medium text-codezal-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUp className="h-3.5 w-3.5" />
          <span>{commitPushLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {menuOpen && (
          <div
            {...menuProps}
            className="cz-menu absolute right-0 top-full z-50 mt-1 w-[280px] overflow-hidden py-1"
          >
            {(Object.keys(actionLabels) as Action[]).map((item) => (
              <button
                key={item}
                type="button"
                role="menuitem"
                onClick={() => openAction(item)}
                className="w-full px-3 py-2 text-left text-sm text-codezal-text hover:bg-codezal-panel-2"
              >
                {actionLabels[item]}
              </button>
            ))}
          </div>
        )}
      </div>

      {action && (
        <Dialog
          onClose={() => !busy && setAction(null)}
          label={actionLabels[action]}
          panelClassName="w-[440px] max-w-[92vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
          initialFocus={inputRef}
          closeOnBackdrop={!busy}
          closeOnEscape={!busy}
        >
          <div className="flex items-center gap-2 border-b border-codezal px-4 py-3">
            {action === "branch-commit-push" ? (
              <GitBranch className="h-4 w-4 text-codezal-dim" />
            ) : action === "commit-pr" ? (
              <GitPullRequest className="h-4 w-4 text-codezal-dim" />
            ) : (
              <ArrowUp className="h-4 w-4 text-codezal-dim" />
            )}
            <h2 className="flex-1 text-sm font-semibold text-codezal-text">{actionLabels[action]}</h2>
            <button
              type="button"
              onClick={() => setAction(null)}
              disabled={busy}
              title={t("common.close")}
              className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            {action === "branch-commit-push" && (
              <label className="block space-y-1.5 text-xs text-codezal-dim">
                <span>{t("newWorktree.branchNameLabel")}</span>
                <input
                  ref={inputRef}
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder={t("newWorktree.branchNamePlaceholder")}
                  className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-sm text-codezal-text outline-none focus:border-codezal-strong"
                />
              </label>
            )}

            <label className="block space-y-1.5 text-xs text-codezal-dim">
              <span>{t("gitPanel.commitMessage")}</span>
              <input
                ref={action === "branch-commit-push" ? undefined : inputRef}
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void runAction()
                  }
                }}
                className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 text-sm text-codezal-text outline-none focus:border-codezal-strong"
              />
            </label>

            {action === "commit-pr" && (
              <>
                <label className="block space-y-1.5 text-xs text-codezal-dim">
                  <span>PR</span>
                  <input
                    value={prTitle}
                    onChange={(event) => setPrTitle(event.target.value)}
                    className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 text-sm text-codezal-text outline-none focus:border-codezal-strong"
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-codezal-dim">
                  <span>{t("newWorktree.baseLabel")}</span>
                  <input
                    value={prBase}
                    onChange={(event) => setPrBase(event.target.value)}
                    className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-sm text-codezal-text outline-none focus:border-codezal-strong"
                  />
                </label>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-codezal px-4 py-3">
            <button
              type="button"
              onClick={() => setAction(null)}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void runAction()}
              disabled={busy || !actionReady}
              className="flex items-center gap-1.5 rounded-md bg-codezal-text px-3 py-1.5 text-sm font-medium text-codezal-bg hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {actionLabels[action]}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
