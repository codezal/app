// BranchPicker — git branch listesi + checkout + yeni branch oluştur.
// Workspace yoksa veya git repo değilse disabled görünüm.
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, GitBranch, Plus } from "lucide-react"
import {
  gitCheckoutBranch,
  gitCreateBranch,
  gitCurrentBranch,
  gitListBranches,
} from "@/lib/git"
import { cn } from "@/lib/utils"

type Props = {
  workspace?: string
  // Checkout başarılı olunca App'in (örn. Sidebar git status) yenilemesi için.
  onChanged?: () => void
}

export function BranchPicker({ workspace, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  // Popover açıkken dış tık ile kapan
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  // Mevcut branch + liste — workspace değişince ve popover açılınca tazele.
  // İmperatif refresh (kullanıcı checkout sonrası listeyi yenilesin diye).
  const [refreshTick, setRefreshTick] = useState(0)
  function bumpRefresh() {
    setRefreshTick((t) => t + 1)
  }

  useEffect(() => {
    let alive = true
    const ws = workspace
    Promise.resolve().then(async () => {
      if (!ws) {
        if (alive) {
          setCurrent(null)
          setBranches([])
        }
        return
      }
      const [cur, list] = await Promise.all([
        gitCurrentBranch(ws),
        gitListBranches(ws),
      ])
      if (!alive) return
      setCurrent(cur)
      setBranches(list)
    })
    return () => {
      alive = false
    }
  }, [workspace, open, refreshTick])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    const sorted = [...branches].sort((a, b) => {
      if (a === current) return -1
      if (b === current) return 1
      return a.localeCompare(b)
    })
    if (!t) return sorted
    return sorted.filter((b) => b.toLowerCase().includes(t))
  }, [branches, current, q])

  async function pick(branch: string) {
    if (!workspace || branch === current) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await gitCheckoutBranch(workspace, branch)
      bumpRefresh()
      onChanged?.()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function createBranch() {
    const name = newName.trim()
    if (!workspace || !name) return
    setBusy(true)
    setError(null)
    try {
      await gitCreateBranch(workspace, name)
      bumpRefresh()
      onChanged?.()
      setCreating(false)
      setNewName("")
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const label = current ?? (workspace ? "branch yok" : "—")
  const disabled = !workspace

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
          setError(null)
        }}
        disabled={disabled}
        title={disabled ? "Bir workspace seç" : `Branch: ${label}`}
        className={cn(
          "flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium",
          disabled
            ? "border-codezal-hair text-codezal-mute opacity-60"
            : "border-codezal text-codezal-dim hover:border-codezal-strong",
        )}
      >
        <GitBranch className="h-2.5 w-2.5" />
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronDown className="h-2 w-2" />
      </button>

      {open && !disabled && (
        <div className="absolute bottom-[32px] left-0 z-50 w-[280px] rounded-md border border-codezal bg-codezal-sidebar shadow-lg">
          <div className="border-b border-codezal-hair p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Branch ara"
              className="w-full bg-transparent px-1.5 py-1 text-[12px] text-codezal-text placeholder:text-codezal-mute outline-none"
              disabled={busy}
            />
          </div>

          <div className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11.5px] text-codezal-mute">
                {branches.length === 0 ? "Branch yok / repo değil" : "Sonuç yok"}
              </div>
            )}
            {filtered.map((b) => (
              <button
                key={b}
                type="button"
                disabled={busy}
                onClick={() => void pick(b)}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px]",
                  b === current
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
                  busy && "opacity-50",
                )}
                title={b}
              >
                <GitBranch className="h-2.5 w-2.5 shrink-0 text-codezal-mute" />
                <span className="truncate">{b}</span>
                {b === current && <span className="ml-auto text-codezal-accent">✓</span>}
              </button>
            ))}
          </div>

          {error && (
            <div className="border-t border-codezal-hair px-2.5 py-1.5 text-[11px] text-red-400">
              {error}
            </div>
          )}

          <div className="border-t border-codezal-hair py-1">
            {creating ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createBranch()
                    if (e.key === "Escape") {
                      setCreating(false)
                      setNewName("")
                      setError(null)
                    }
                  }}
                  placeholder="yeni-branch-adı"
                  className="flex-1 bg-transparent px-1 py-0.5 text-[12px] text-codezal-text placeholder:text-codezal-mute outline-none"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => void createBranch()}
                  disabled={busy || !newName.trim()}
                  className="rounded px-1.5 py-0.5 text-[11px] text-codezal-accent disabled:opacity-40"
                >
                  oluştur
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setError(null)
                }}
                disabled={busy}
                className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[12px] text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text"
              >
                <Plus className="h-2.5 w-2.5" />
                Yeni branch oluştur…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
