// Status-bar CI-checks indicator. When the workspace is a GitHub repo with a
// stored token and an open PR for the current branch, it shows the PR's combined
// check rollup (pass / fail / pending). Clicking it opens the git panel straight
// on its PR view. Reuses the same github.ts calls as PRPanel — no new backend.
import { useEffect, useState } from "react"
import { CheckCircle2, Circle, Loader2, XCircle } from "@/lib/icons"
import {
  findPrForBranch,
  getCombinedChecks,
  getGithubToken,
  getPrDetail,
  listPullRequests,
  resolveRepo,
  type CheckState,
} from "@/lib/github"
import { gitCurrentBranch } from "@/lib/git"
import { onGitChanged } from "@/lib/git-events"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

const OPEN_PR_VIEW = "codezal:open-pr-view"

function usePrChecks(workspace?: string) {
  const [rollup, setRollup] = useState<CheckState | null>(null)
  const [hasPr, setHasPr] = useState(false)

  useEffect(() => {
    let alive = true
    const clear = () => {
      setRollup(null)
      setHasPr(false)
    }
    const run = async () => {
      if (!workspace) {
        if (alive) clear()
        return
      }
      const tok = await getGithubToken()
      if (!tok || !alive) {
        if (alive) clear()
        return
      }
      const repo = await resolveRepo(workspace)
      if (!repo || !alive) {
        if (alive) clear()
        return
      }
      const [list, branch] = await Promise.all([
        listPullRequests(tok, repo, "open").catch(() => []),
        gitCurrentBranch(workspace),
      ])
      if (!alive) return
      const pr = findPrForBranch(list, branch)
      if (!pr) {
        if (alive) clear()
        return
      }
      const detail = await getPrDetail(tok, repo, pr.number).catch(() => null)
      if (!detail || !alive) {
        if (alive) {
          setHasPr(true)
          setRollup("pending")
        }
        return
      }
      const checks = await getCombinedChecks(tok, repo, detail.summary.headSha).catch(() => null)
      if (!alive) return
      setHasPr(true)
      setRollup(checks?.rollup ?? "pending")
    }
    void run()
    const off = onGitChanged(() => void run())
    return () => {
      alive = false
      off()
    }
  }, [workspace])

  return { rollup, hasPr }
}

export function ChecksBar({ workspace }: { workspace: string }) {
  const t = useT()
  const { rollup, hasPr } = usePrChecks(workspace)
  if (!hasPr || !rollup) return null

  const Icon =
    rollup === "success"
      ? CheckCircle2
      : rollup === "failure"
        ? XCircle
        : rollup === "pending"
          ? Loader2
          : Circle
  const color =
    rollup === "success"
      ? "text-emerald-500"
      : rollup === "failure"
        ? "text-destructive"
        : "text-codezal-mute"

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PR_VIEW))}
      title={t("statusBar.checksTitle", { state: rollup })}
      aria-label={t("statusBar.checksOpen")}
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
    >
      <Icon
        className={cn("h-3.5 w-3.5", color, rollup === "pending" && "animate-spin")}
        aria-hidden
      />
      <span className="cz-meta-label">{t("statusBar.checksLabel")}</span>
    </button>
  )
}
