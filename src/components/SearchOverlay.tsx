import { useEffect, useMemo, useRef, useState } from "react"
import { FileText, Regex, Search, X } from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import { searchWorkspace, type SearchHit } from "@/lib/search"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { errorMessage } from "@/lib/errors"
import { Dialog } from "@/components/Dialog"

type Props = {
  open: boolean
  onClose: () => void
}

export function SearchOverlay({ open, onClose }: Props) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [glob, setGlob] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = useSessionsStore((s) => s.active)
  const openFile = useSessionsStore((s) => s.openFile)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!active?.workspacePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([])
      setError(t("searchOverlay.folderNotConnected"))
      setLoading(false)
      return
    }
    const q = query.trim()
    if (!q) {
      setHits([])
      setError(null)
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    const timer = setTimeout(() => {
      void searchWorkspace(active.workspacePath!, q, {
        regex,
        caseSensitive,
        glob: glob.trim() || undefined,
      })
        .then(setHits)
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, regex, caseSensitive, glob, active?.workspacePath])

  const groups = useMemo(() => groupByFile(hits), [hits])

  if (!open) return null

  return (
    <Dialog
      onClose={onClose}
      label={t("searchOverlay.title")}
      align="start"
      backdropClassName="z-50"
      panelClassName="mt-[10vh] flex h-[78vh] w-[820px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
    >
        <div className="border-b border-codezal px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-codezal-mute" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("commandPalette.workspaceSearch")}
              className="flex-1 bg-transparent text-md text-codezal-text placeholder:text-codezal-mute focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setRegex((v) => !v)}
              title={t("searchOverlay.regex")}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded border",
                regex
                  ? "border-codezal-accent text-codezal-accent"
                  : "border-codezal text-codezal-mute hover:text-codezal-text",
              )}
            >
              <Regex className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCaseSensitive((v) => !v)}
              title={t("searchOverlay.caseSensitive")}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded border font-mono text-sm font-semibold",
                caseSensitive
                  ? "border-codezal-accent text-codezal-accent"
                  : "border-codezal text-codezal-mute hover:text-codezal-text",
              )}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded p-1 text-codezal-mute hover:text-codezal-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-codezal-mute">{t("searchOverlay.globLabel")}</span>
            <input
              value={glob}
              onChange={(e) => setGlob(e.target.value)}
              placeholder={t("searchOverlay.globPlaceholder")}
              className="h-6 flex-1 rounded border border-codezal bg-transparent px-2 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-strong focus:outline-none"
            />
            <span className="text-codezal-mute">
              {loading ? t("searchOverlay.loadingDots") : t("searchOverlay.resultsCount", { count: hits.length })}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {error && (
            <div className="m-3 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
              {error}
            </div>
          )}
          {!error && hits.length === 0 && query.trim() && !loading && (
            <div className="px-4 py-8 text-center text-sm text-codezal-mute">
              {t("searchOverlay.noResults")}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.path} className="border-b border-codezal/60">
              <button
                type="button"
                onClick={() => {
                  openFile(g.path)
                  onClose()
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-codezal-panel-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-codezal-accent" />
                <span className="truncate text-base text-codezal-text">{g.rel}</span>
                <span className="ml-1 text-sm text-codezal-mute">{g.hits.length}</span>
              </button>
              <div className="bg-codezal-bg/40">
                {g.hits.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      openFile(h.path)
                      onClose()
                    }}
                    className="flex w-full items-baseline gap-2 px-5 py-0.5 text-left hover:bg-codezal-panel-2"
                  >
                    <span className="w-10 shrink-0 text-right font-mono text-sm text-codezal-mute">
                      {h.line}
                    </span>
                    <span className="truncate font-mono text-sm text-codezal-dim">
                      {h.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-codezal px-3 py-1.5 text-sm text-codezal-mute">
          <span>{t("searchOverlay.footerHelp")}</span>
          <span>{t("searchOverlay.rgFaster")}</span>
        </div>
    </Dialog>
  )
}

function groupByFile(hits: SearchHit[]): { path: string; rel: string; hits: SearchHit[] }[] {
  const map = new Map<string, { path: string; rel: string; hits: SearchHit[] }>()
  for (const h of hits) {
    const g = map.get(h.path) ?? { path: h.path, rel: h.rel, hits: [] }
    g.hits.push(h)
    map.set(h.path, g)
  }
  return Array.from(map.values())
}
