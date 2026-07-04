import { useEffect, useState } from "react"
import { GitBranch } from "@/lib/icons"
import { Dialog } from "@/components/Dialog"
import { createWorktree, findRepoRoot, listBranches } from "@/lib/tools/worktree"
import { gitCurrentBranch } from "@/lib/git"
import { runBash } from "@/lib/tools/shell"
import { errorMessage } from "@/lib/errors"
import { toast } from "@/store/toast"
import { useT } from "@/lib/i18n/useT"

type Props = {
  repoPath: string | null
  onClose: () => void
  onCreated: (worktreePath: string) => void
}

export function NewWorktreeDialog({ repoPath, onClose, onCreated }: Props) {
  const t = useT()
  const [root, setRoot] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState("")
  const [name, setName] = useState("")
  const [envScript, setEnvScript] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // setState'ler mikrotask'a ertelenir (Promise.resolve().then) — senkron effect
  useEffect(() => {
    if (!repoPath) return
    let alive = true
    void Promise.resolve().then(async () => {
      setLoading(true)
      setError(null)
      setName("")
      setEnvScript("")
      const r = await findRepoRoot(repoPath)
      if (!alive) return
      if (!r) {
        setRoot(null)
        setError(t("newWorktree.repoInvalid", { path: repoPath }))
        setLoading(false)
        return
      }
      setRoot(r)
      const [list, cur] = await Promise.all([listBranches(r), gitCurrentBranch(r)])
      if (!alive) return
      setBranches(list)
      setBase(cur ?? list[0] ?? "")
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [repoPath, t])

  async function submit() {
    const branch = name.trim()
    if (!root || !branch || !base) return
    setBusy(true)
    setError(null)
    let worktreePath: string
    try {
      const entry = await createWorktree({ repoPath: root, branch, baseRef: base })
      worktreePath = entry.path
    } catch (e) {
      setError(t("newWorktree.createFailed", { msg: errorMessage(e) }))
      setBusy(false)
      return
    }
    const script = envScript.trim()
    if (script) {
      toast.info(t("newWorktree.envStarted"))
      void runBash(worktreePath, script, {
        sessionId: `wt-setup:${worktreePath}`,
        timeoutMs: 600_000,
      })
        .then(() => toast.success(t("newWorktree.envRan")))
        .catch((e) => toast.error(t("newWorktree.envFailed", { msg: errorMessage(e) })))
    }
    setBusy(false)
    onCreated(worktreePath)
    onClose()
  }

  if (!repoPath) return null

  const canSubmit = !!root && !!base && !!name.trim() && !busy && !loading

  return (
    <Dialog
      onClose={busy ? () => {} : onClose}
      label={t("newWorktree.title")}
      align="start"
      backdropClassName="z-[60]"
      panelClassName="mt-[18vh] w-[460px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
        <GitBranch className="h-4 w-4 text-codezal-accent" aria-hidden />
        <span className="text-base font-medium text-codezal-text">{t("newWorktree.title")}</span>
      </div>

      <div className="space-y-3 px-3 py-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-codezal-mute">{t("newWorktree.baseLabel")}</span>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            disabled={busy || loading || branches.length === 0}
            className="w-full rounded-md border border-codezal bg-codezal-panel-2 px-2 py-1.5 text-codezal-text outline-none disabled:opacity-50"
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-codezal-mute">{t("newWorktree.branchNameLabel")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) void submit()
            }}
            placeholder={t("newWorktree.branchNamePlaceholder")}
            disabled={busy}
            className="w-full rounded-md border border-codezal bg-codezal-panel-2 px-2 py-1.5 font-mono text-codezal-text placeholder:text-codezal-mute outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-codezal-mute">{t("newWorktree.envScriptLabel")}</span>
          <textarea
            value={envScript}
            onChange={(e) => setEnvScript(e.target.value)}
            placeholder={t("newWorktree.envScriptPlaceholder")}
            disabled={busy}
            rows={2}
            className="w-full resize-y rounded-md border border-codezal bg-codezal-panel-2 px-2 py-1.5 font-mono text-sm text-codezal-text placeholder:text-codezal-mute outline-none"
          />
        </label>

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive">{error}</div>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-codezal px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-codezal px-2.5 py-1.5 text-sm text-codezal-dim hover:text-codezal-text disabled:opacity-50"
        >
          {t("newWorktree.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? t("newWorktree.creating") : t("newWorktree.create")}
        </button>
      </div>
    </Dialog>
  )
}
