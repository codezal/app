// Git tab — branch + ahead/behind + dosya listesi + tıklayınca diff modal.
import { useCallback, useEffect, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight as ChevRight,
  GitBranch,
  RefreshCcw,
  X,
} from "lucide-react"
import { gitDiffFile, gitStatus, statusLabel, type GitStatus, type GitStatusEntry } from "@/lib/git"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

type Props = {
  workspacePath?: string
}

export function GitPanel({ workspacePath }: Props) {
  const t = useT()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffFor, setDiffFor] = useState<GitStatusEntry | null>(null)

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setError(null)
    try {
      const s = await gitStatus(workspacePath)
      setStatus(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!workspacePath) {
    return (
      <div className="px-1 py-3 text-[12px] text-codezal-mute">
        {t("gitPanel.notConnectedHint")}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header: branch + ahead/behind + refresh */}
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-codezal-accent" />
        <span className="truncate text-[13px] font-medium text-codezal-text">
          {status?.info.branch ?? (status?.isRepo === false ? t("gitPanel.notRepoLabel") : "…")}
        </span>
        {status?.info.upstream && (
          <span className="truncate text-[11px] text-codezal-mute">
            → {status.info.upstream}
          </span>
        )}
        <div className="flex-1" />
        {status?.info.ahead ? (
          <span className="flex items-center gap-0.5 text-[11px] text-codezal-accent">
            <ArrowUp className="h-2.5 w-2.5" />
            {status.info.ahead}
          </span>
        ) : null}
        {status?.info.behind ? (
          <span className="flex items-center gap-0.5 text-[11px] text-codezal-dim">
            <ArrowDown className="h-2.5 w-2.5" />
            {status.info.behind}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("gitPanel.refresh")}
          className="rounded p-1 text-codezal-mute hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {/* Dosya listesi — staged + unstaged grupları */}
      {status?.isRepo === false ? (
        <div className="px-1 py-2 text-[12px] text-codezal-mute">
          {t("gitPanel.notARepoHint", { gitinit: "git init" })}
        </div>
      ) : status?.entries.length === 0 ? (
        <div className="px-1 py-2 text-[12px] text-codezal-mute">
          {t("gitPanel.cleanWorktree")}
        </div>
      ) : status ? (
        <FileGroups entries={status.entries} onPick={setDiffFor} />
      ) : null}

      {/* Diff modal */}
      {diffFor && workspacePath && (
        <DiffModal
          workspace={workspacePath}
          entry={diffFor}
          onClose={() => setDiffFor(null)}
        />
      )}
    </div>
  )
}

function FileGroups({
  entries,
  onPick,
}: {
  entries: GitStatusEntry[]
  onPick: (e: GitStatusEntry) => void
}) {
  // Index karakterine göre staged vs unstaged ayır
  const staged = entries.filter((e) => e.index !== " " && e.index !== "?" && e.index !== "!")
  const unstaged = entries.filter(
    (e) => (e.worktree !== " " && e.worktree !== "!") || e.index === "?",
  )

  return (
    <div className="space-y-3">
      {staged.length > 0 && (
        <Group label={tStatic("gitPanel.stagedLabel")} count={staged.length}>
          {staged.map((e) => (
            <FileRow key={"s" + e.path} entry={e} onClick={() => onPick(e)} staged />
          ))}
        </Group>
      )}
      {unstaged.length > 0 && (
        <Group label={tStatic("gitPanel.modifiedLabel")} count={unstaged.length}>
          {unstaged.map((e) => (
            <FileRow key={"u" + e.path} entry={e} onClick={() => onPick(e)} />
          ))}
        </Group>
      )}
    </div>
  )
}

function Group({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-codezal-dim"
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevRight className="h-2.5 w-2.5" />
        )}
        <span>{label}</span>
        <span className="text-codezal-mute">·</span>
        <span className="text-codezal-mute">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  )
}

function FileRow({
  entry,
  onClick,
  staged,
}: {
  entry: GitStatusEntry
  onClick: () => void
  staged?: boolean
}) {
  const l = statusLabel(entry)
  const color = l.kind === "add"
    ? "text-codezal-accent"
    : l.kind === "del"
    ? "text-destructive"
    : l.kind === "untracked"
    ? "text-codezal-accent"
    : l.kind === "conflict"
    ? "text-destructive"
    : "text-codezal-dim"
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[12px] hover:bg-codezal-panel-2"
      title={entry.path}
    >
      <span className={cn("w-4 shrink-0 font-mono text-[10.5px]", color)}>{l.code.trim() || "·"}</span>
      <span className="flex-1 truncate text-codezal-text">{entry.path}</span>
      {staged && (
        <span className="shrink-0 rounded bg-codezal-accent-dim px-1 py-0 text-[9.5px] text-codezal-accent">
          ●
        </span>
      )}
    </button>
  )
}

function DiffModal({
  workspace,
  entry,
  onClose,
}: {
  workspace: string
  entry: GitStatusEntry
  onClose: () => void
}) {
  const t = useT()
  const [diff, setDiff] = useState<string | null>(null)
  const [staged, setStaged] = useState(false)

  useEffect(() => {
    let alive = true
    setDiff(null)
    void gitDiffFile(workspace, entry.path, staged).then((d) => {
      if (alive) setDiff(d || tStatic("gitPanel.diffEmpty"))
    })
    return () => {
      alive = false
    }
  }, [workspace, entry.path, staged])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-[860px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-codezal px-3 py-2">
          <span className="truncate text-[13px] font-medium text-codezal-text">
            {entry.path}
          </span>
          <div className="flex-1" />
          <div className="flex rounded-md border border-codezal text-[11px]">
            <button
              type="button"
              onClick={() => setStaged(false)}
              className={cn(
                "px-2 py-0.5",
                !staged ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim",
              )}
            >
              {t("gitPanel.worktreeTab")}
            </button>
            <button
              type="button"
              onClick={() => setStaged(true)}
              className={cn(
                "px-2 py-0.5",
                staged ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim",
              )}
            >
              {t("gitPanel.stagedTab")}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="flex-1 overflow-auto bg-codezal-bg">
          {diff === null ? (
            <div className="px-3 py-2 text-[12px] text-codezal-mute">…</div>
          ) : (
            <DiffView text={diff} />
          )}
        </div>
      </div>
    </div>
  )
}

// Renkli diff render: + yeşil, - kırmızı, @@ mavi, dosya başlığı vurgulu.
function DiffView({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.5]">
      {lines.map((l, i) => {
        let cls = "text-codezal-text"
        if (l.startsWith("+++") || l.startsWith("---")) cls = "text-codezal-mute font-semibold"
        else if (l.startsWith("@@")) cls = "text-codezal-accent"
        else if (l.startsWith("+")) cls = "bg-codezal-diff-add text-codezal-diff-add"
        else if (l.startsWith("-")) cls = "bg-codezal-diff-del text-codezal-diff-del"
        else if (l.startsWith("diff ") || l.startsWith("index ")) cls = "text-codezal-mute"
        return (
          <div key={i} className={cn("px-3", cls)}>
            {l || " "}
          </div>
        )
      })}
    </pre>
  )
}
