// GitHub PR panel — list the repo's pull requests and show the selected PR's
// Reviewers / Checks / Changes, read-only. Mirrors GitPanel's shape (workspacePath
// prop, refresh callback). Token is entered inline and stored in the keychain.
// "AI Review" reuses the existing /review command via a window event handled in
// App.tsx; this panel posts nothing back to GitHub.
import { useCallback, useEffect, useRef, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
  RefreshCcw,
  Sparkles,
  XCircle,
} from "@/lib/icons"
import {
  getGithubToken,
  setGithubToken,
  resolveRepo,
  listPullRequests,
  listIssues,
  getPrDetail,
  getCombinedChecks,
  listPrFiles,
  listPrConversation,
  findPrForBranch,
  GithubApiError,
  type OwnerRepo,
  type PullRequestSummary,
  type IssueSummary,
  type PrDetail,
  type CombinedChecks,
  type PrFile,
  type CheckState,
  type ReviewerItem,
} from "@/lib/github"
import { gitCurrentBranch } from "@/lib/git"
import {
  startPrReviewDaemon,
  stopPrReviewDaemon,
  readDaemonConfig,
  writeDaemonConfig,
} from "@/lib/pr-review-daemon"
import { makePrDoc } from "@/lib/pr-uri"
import { useSessionsStore } from "@/store/sessions"
import { toast } from "@/store/toast"
import { useT } from "@/lib/i18n/useT"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

function openExternal(url: string | null | undefined) {
  if (url && /^https?:\/\//i.test(url)) void openUrl(url).catch(() => {})
}

type Phase = "loading" | "no-token" | "no-remote" | "error" | "ready"

export function PRPanel({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>("loading")
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [repo, setRepo] = useState<OwnerRepo | null>(null)
  const [prs, setPrs] = useState<PullRequestSummary[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [tab, setTab] = useState<"prs" | "issues">("prs")
  const [autoReview, setAutoReview] = useState(() => readDaemonConfig().enabled)
  const loadSeq = useRef(0)

  useEffect(() => {
    if (autoReview && phase === "ready" && workspacePath) startPrReviewDaemon(workspacePath)
  }, [autoReview, phase, workspacePath])

  const toggleAutoReview = useCallback(() => {
    const next = !autoReview
    writeDaemonConfig({ ...readDaemonConfig(), enabled: next })
    setAutoReview(next)
    if (next) {
      startPrReviewDaemon(workspacePath)
      toast.success("Otomatik PR incelemesi açık — yeni PR'lar incelenip yorumlanacak")
    } else {
      stopPrReviewDaemon()
      toast.info("Otomatik PR incelemesi kapalı")
    }
  }, [autoReview, workspacePath])

  const renderError = useCallback(
    (e: unknown): string => {
      if (e instanceof GithubApiError) {
        if (e.info.kind === "unauthorized") return t("prPanel.invalidToken")
        if (e.info.kind === "rate_limit") return t("prPanel.rateLimited")
      }
      return errorMessage(e)
    },
    [t],
  )

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setPhase("loading")
    setErrMsg(null)
    const tok = await getGithubToken()
    if (seq !== loadSeq.current) return
    if (!tok) {
      setPhase("no-token")
      return
    }
    setToken(tok)
    const r = await resolveRepo(workspacePath ?? "")
    if (seq !== loadSeq.current) return
    if (!r) {
      setPhase("no-remote")
      return
    }
    setRepo(r)
    try {
      const [list, branch] = await Promise.all([
        listPullRequests(tok, r, "open"),
        gitCurrentBranch(workspacePath ?? ""),
      ])
      if (seq !== loadSeq.current) return
      setPrs(list)
      setCurrentBranch(branch)
      setPhase("ready")
      const auto = findPrForBranch(list, branch) ?? list[0] ?? null
      setSelected(auto ? auto.number : null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      if (e instanceof GithubApiError && e.info.kind === "unauthorized") {
        setErrMsg(t("prPanel.invalidToken"))
        setPhase("no-token")
        return
      }
      setErrMsg(renderError(e))
      setPhase("error")
    }
  }, [workspacePath, t, renderError])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  if (phase === "no-token") {
    return <TokenForm initialError={errMsg} onSaved={() => void load()} />
  }
  if (phase === "no-remote") {
    return (
      <EmptyState icon={GitPullRequest} title={t("prPanel.noRemoteTitle")}>
        {t("prPanel.noRemoteHint")}
      </EmptyState>
    )
  }
  if (phase === "loading") {
    return <div className="px-1 py-6 text-center text-sm text-codezal-mute">{t("prPanel.loading")}</div>
  }
  if (phase === "error") {
    return (
      <EmptyState icon={AlertCircle} title={t("prPanel.errorTitle")}>
        <span className="text-codezal-dim">{errMsg}</span>
        <button type="button" onClick={() => void load()} className={btnGhost}>
          {t("prPanel.retry")}
        </button>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium uppercase tracking-wide text-codezal-mute">
          {repo ? `${repo.owner}/${repo.repo}` : t("prPanel.pullRequests")}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleAutoReview}
            title="Yeni PR'ları otomatik AI ile incele ve yorum bırak"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm",
              autoReview
                ? "bg-codezal-accent text-white"
                : "text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Auto-review</span>
          </button>
          <button type="button" onClick={() => void load()} title={t("prPanel.refresh")} className={iconBtn}>
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1">
        <button type="button" onClick={() => setTab("prs")} className={cn(tabBtn, tab === "prs" && tabBtnActive)}>
          {t("prPanel.pullRequests")}
        </button>
        <button
          type="button"
          onClick={() => setTab("issues")}
          className={cn(tabBtn, tab === "issues" && tabBtnActive)}
        >
          {t("prPanel.issues")}
        </button>
      </div>

      {tab === "issues" ? (
        <IssuesSection
          token={token!}
          repo={repo!}
          workspacePath={workspacePath}
          renderError={renderError}
        />
      ) : (
        <>
          {prs.length === 0 ? (
            <EmptyState icon={GitPullRequest} title={t("prPanel.noPrsTitle")} />
          ) : (
            <div className="flex flex-col gap-0.5">
              {prs.map((pr) => (
                <button
                  key={pr.number}
                  type="button"
                  onClick={() => setSelected(pr.number)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md px-2 py-1 text-left hover:bg-codezal-panel-2",
                    selected === pr.number && "bg-codezal-panel-2",
                  )}
                  title={pr.title}
                >
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 text-sm text-codezal-mute">#{pr.number}</span>
                    <span className="truncate text-sm text-codezal-text">{pr.title}</span>
                    {pr.draft && (
                      <span className="ml-auto shrink-0 text-sm uppercase text-codezal-mute">
                        {t("prPanel.draft")}
                      </span>
                    )}
                  </span>
                  <span className="truncate pl-7 font-mono text-sm text-codezal-dim">
                    {pr.headRef} → {pr.baseRef}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selected != null && repo && token && (
            <PrDetailView
              token={token}
              repo={repo}
              num={selected}
              currentBranch={currentBranch}
              renderError={renderError}
            />
          )}
        </>
      )}
    </div>
  )
}

function IssuesSection({
  token,
  repo,
  workspacePath,
  renderError,
}: {
  token: string
  repo: OwnerRepo
  workspacePath?: string
  renderError: (e: unknown) => string
}) {
  const t = useT()
  const [issues, setIssues] = useState<IssueSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    /* eslint-disable react-hooks/set-state-in-effect */
    setIssues(null)
    setErr(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const list = await listIssues(token, repo, "open")
        if (alive) setIssues(list)
      } catch (e) {
        if (alive) setErr(renderError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [token, repo, renderError])

  const sendToAgent = (iss: IssueSummary) => {
    window.dispatchEvent(
      new CustomEvent("codezal:issue-to-agent", {
        detail: { repoPath: workspacePath ?? "", number: iss.number, title: iss.title },
      }),
    )
  }

  if (err) {
    return <div className="rounded-md border border-codezal-hair px-2 py-2 text-sm text-codezal-dim">{err}</div>
  }
  if (!issues) {
    return <div className="px-1 py-4 text-center text-sm text-codezal-mute">{t("prPanel.loading")}</div>
  }
  if (issues.length === 0) {
    return <EmptyState icon={Circle} title={t("prPanel.noIssuesTitle")} />
  }
  return (
    <div className="flex flex-col gap-0.5">
      {issues.map((iss) => (
        <div
          key={iss.number}
          className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-codezal-panel-2"
        >
          <span className="shrink-0 pt-0.5 text-sm text-codezal-mute">#{iss.number}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-codezal-text" title={iss.title}>
              {iss.title}
            </div>
            {iss.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {iss.labels.slice(0, 4).map((l) => (
                  <span key={l} className="rounded bg-codezal-panel-2 px-1 text-sm text-codezal-dim">
                    {l}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => sendToAgent(iss)}
            title={t("prPanel.sendToAgent")}
            className="shrink-0 rounded-md p-1 text-codezal-mute hover:bg-codezal-accent hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function PrDetailView({
  token,
  repo,
  num,
  currentBranch,
  renderError,
}: {
  token: string
  repo: OwnerRepo
  num: number
  currentBranch: string | null
  renderError: (e: unknown) => string
}) {
  const t = useT()
  const openFile = useSessionsStore((s) => s.openFile)
  const [detail, setDetail] = useState<PrDetail | null>(null)
  const [checks, setChecks] = useState<CombinedChecks | null>(null)
  const [files, setFiles] = useState<PrFile[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    /* eslint-disable react-hooks/set-state-in-effect */
    setDetail(null)
    setChecks(null)
    setFiles(null)
    setErr(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const d = await getPrDetail(token, repo, num)
        if (!alive) return
        setDetail(d)
        const [c, f] = await Promise.all([
          getCombinedChecks(token, repo, d.summary.headSha).catch(() => null),
          listPrFiles(token, repo, num).catch(() => [] as PrFile[]),
        ])
        if (!alive) return
        setChecks(c)
        setFiles(f)
      } catch (e) {
        if (alive) setErr(renderError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [token, repo, num, renderError])

  if (err) {
    return <div className="rounded-md border border-codezal-hair px-2 py-2 text-sm text-codezal-dim">{err}</div>
  }
  if (!detail) {
    return <div className="px-1 py-4 text-center text-sm text-codezal-mute">{t("prPanel.loading")}</div>
  }

  const canReview = currentBranch != null && currentBranch === detail.summary.headRef
  const onAiReview = () => {
    window.dispatchEvent(
      new CustomEvent("codezal:run-review", { detail: { args: detail.summary.baseRef } }),
    )
  }

  const onViewComments = async () => {
    try {
      const comments = await listPrConversation(token, repo, num)
      openFile(
        makePrDoc({
          number: detail.summary.number,
          title: detail.summary.title,
          htmlUrl: detail.summary.htmlUrl,
          author: detail.summary.author,
          body: detail.body,
          comments,
        }),
      )
    } catch {
      // Intentionally ignored.
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-codezal-hair pt-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onAiReview}
          disabled={!canReview}
          title={canReview ? undefined : t("prPanel.aiReviewNeedsBranch")}
          className={cn(btnAccent, !canReview && "cursor-not-allowed opacity-50 hover:opacity-50")}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("prPanel.aiReview")}
        </button>
        <button type="button" onClick={() => void onViewComments()} className={btnGhost}>
          <MessageSquare className="h-3.5 w-3.5" />
          {t("prPanel.viewComments")}
        </button>
        <button
          type="button"
          onClick={() => openExternal(detail.summary.htmlUrl)}
          className={btnGhost}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          GitHub
        </button>
      </div>

      <Section label={t("prPanel.reviewers")}>
        {detail.reviewers.length === 0 ? (
          <Dim>—</Dim>
        ) : (
          detail.reviewers.map((rv) => <ReviewerRow key={rv.login} item={rv} />)
        )}
      </Section>

      <Section
        label={t("prPanel.checks")}
        right={checks ? <CheckGlyph state={checks.rollup} /> : undefined}
      >
        {!checks || checks.items.length === 0 ? (
          <Dim>—</Dim>
        ) : (
          checks.items.map((c, i) => (
            <div key={`${c.name}-${i}`} className="flex items-center gap-2 py-0.5">
              <CheckGlyph state={c.state} />
              <span className="truncate text-sm text-codezal-text">{c.name}</span>
              {c.detailsUrl && (
                <button
                  type="button"
                  onClick={() => openExternal(c.detailsUrl)}
                  className="ml-auto shrink-0 text-codezal-mute hover:text-codezal-text"
                  title="GitHub"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          ))
        )}
      </Section>

      <Section
        label={t("prPanel.changes")}
        right={`+${detail.additions} −${detail.deletions}`}
      >
        <div className="flex gap-3 pb-1 text-sm text-codezal-mute">
          <span>{detail.changedFiles} {t("prPanel.files")}</span>
          <span>{detail.commits} {t("prPanel.commits")}</span>
        </div>
        {(files ?? []).map((f) => (
          <button
            key={f.filename}
            type="button"
            onClick={() => openExternal(f.blobUrl)}
            className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-codezal-panel-2"
            title={f.filename}
          >
            <span className="truncate font-mono text-sm text-codezal-text">{f.filename}</span>
            <span className="ml-auto shrink-0 font-mono text-sm">
              <span className="text-green-500">+{f.additions}</span>{" "}
              <span className="text-red-500">−{f.deletions}</span>
            </span>
          </button>
        ))}
      </Section>
    </div>
  )
}


const iconBtn =
  "rounded-md p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
const tabBtn =
  "rounded-md px-2 py-0.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
const tabBtnActive = "bg-codezal-panel-2 text-codezal-text"
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-md border border-codezal-hair px-2 py-1 text-sm text-codezal-text hover:bg-codezal-panel-2"
const btnAccent =
  "inline-flex items-center gap-1.5 rounded-md bg-codezal-accent px-2.5 py-1 text-sm font-medium text-white hover:opacity-90"

function Dim({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-codezal-dim">{children}</span>
}

function Section({
  label,
  right,
  children,
}: {
  label: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium uppercase tracking-wide text-codezal-mute hover:text-codezal-text"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{label}</span>
        {right != null && <span className="ml-auto normal-case text-codezal-dim">{right}</span>}
      </button>
      {open && <div className="flex flex-col pl-1">{children}</div>}
    </div>
  )
}

function CheckGlyph({ state }: { state: CheckState }) {
  if (state === "success") return <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
  if (state === "failure") return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
  if (state === "pending")
    return <Circle className="h-3.5 w-3.5 shrink-0 animate-pulse text-amber-500" />
  return <Circle className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
}

function ReviewerRow({ item }: { item: ReviewerItem }) {
  const glyph =
    item.state === "approved" ? (
      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
    ) : item.state === "changes_requested" ? (
      <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
    ) : item.state === "commented" ? (
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
    ) : (
      <Circle className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
    )
  return (
    <div className="flex items-center gap-2 py-0.5">
      {glyph}
      <span className="truncate text-sm text-codezal-text">{item.login}</span>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <Icon className="h-6 w-6 text-codezal-mute" />
      <div className="text-sm text-codezal-text">{title}</div>
      {children && <div className="flex flex-col items-center gap-2 text-sm text-codezal-mute">{children}</div>}
    </div>
  )
}

function TokenForm({
  initialError,
  onSaved,
}: {
  initialError: string | null
  onSaved: () => void
}) {
  const t = useT()
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const tok = value.trim()
    if (!tok) return
    setBusy(true)
    await setGithubToken(tok)
    setValue("")
    setBusy(false)
    onSaved()
  }

  return (
    <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
      <GitPullRequest className="h-6 w-6 text-codezal-mute" />
      <div className="text-sm text-codezal-text">{t("prPanel.connectTitle")}</div>
      <div className="text-sm text-codezal-mute">{t("prPanel.connectHint")}</div>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save()
        }}
        placeholder={t("prPanel.tokenPlaceholder")}
        className="w-full rounded-md border border-codezal-hair bg-codezal-input px-2 py-1 text-sm text-codezal-text outline-none focus:border-codezal-strong"
      />
      {initialError && <div className="text-sm text-red-500">{initialError}</div>}
      <button type="button" onClick={() => void save()} disabled={busy || !value.trim()} className={btnAccent}>
        {t("prPanel.save")}
      </button>
    </div>
  )
}
