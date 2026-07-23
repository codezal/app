import { useEffect, useRef, useState } from "react"
import { RefreshCcw, Search } from "@/lib/icons"
import { db } from "@/lib/db"
import { useSettingsStore } from "@/store/settings"
import { embedMany, type EmbeddingConfig } from "@/lib/embedding"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { Section } from "./primitives"
import { reindexHistory, type IndexableHarness, type ReindexResult } from "@/lib/harness-history/indexer"
import {
  ensureHistorySchema,
  searchThreads,
  hybridSearch,
  getThreadMessages,
  historyStats,
} from "@/lib/harness-history/store"
import type { HarnessMessage, ThreadHit } from "@/lib/harness-history/types"

const HARNESS_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  cursor: "Cursor",
}

type SelectableHarness = IndexableHarness

export function HistoryTab() {
  const t = useT()
  const tx = (key: string, en: string) => {
    const v = t(`settings.history.${key}` as Parameters<typeof t>[0])
    return v === `settings.history.${key}` ? en : v
  }

  const [picked, setPicked] = useState<Record<SelectableHarness, boolean>>({
    "claude-code": true,
    codex: true,
    opencode: true,
    cursor: true,
  })
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ThreadHit[]>([])
  const [indexing, setIndexing] = useState(false)
  const [result, setResult] = useState<ReindexResult | null>(null)
  const [stats, setStats] = useState<{ harness: string; threads: number; messages: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openMsgs, setOpenMsgs] = useState<HarnessMessage[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const semanticCfg = useSettingsStore((s) => s.settings.semantic)
  const [semantic, setSemantic] = useState(false)
  const [embedProgress, setEmbedProgress] = useState<{ done: number; total: number } | null>(null)
  const embedCfg: EmbeddingConfig | null =
    semanticCfg && semanticCfg.model
      ? {
          provider: semanticCfg.provider,
          baseUrl: semanticCfg.baseUrl,
          model: semanticCfg.model,
          apiKey: semanticCfg.apiKey,
        }
      : null

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await ensureHistorySchema(db)
        const s = await historyStats(db)
        if (alive) setStats(s)
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )

  const totalThreads = stats.reduce((n, s) => n + s.threads, 0)

  async function onIndex() {
    const harnesses = (Object.keys(picked) as SelectableHarness[]).filter((h) => picked[h])
    if (harnesses.length === 0) return
    setIndexing(true)
    setError(null)
    try {
      const r = await reindexHistory(
        harnesses,
        semantic && embedCfg
          ? { embed: embedCfg, onEmbedProgress: (done, total) => setEmbedProgress({ done, total }) }
          : {},
      )
      setResult(r)
      setStats(await historyStats(db))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setIndexing(false)
      setEmbedProgress(null)
    }
  }

  function onQueryChange(q: string) {
    setQuery(q)
    setOpenId(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) {
      setHits([])
      return
    }
    searchTimer.current = setTimeout(() => void runSearch(q), 250)
  }

  async function runSearch(q: string) {
    setSearching(true)
    try {
      if (semantic && embedCfg) {
        const [qv] = await embedMany(embedCfg, [q])
        setHits(await hybridSearch(db, q, qv ?? null, { limit: 30 }))
      } else {
        setHits(await searchThreads(db, q, { limit: 30 }))
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  async function toggleOpen(id: string) {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    try {
      setOpenMsgs(await getThreadMessages(db, id))
    } catch {
      setOpenMsgs([])
    }
  }

  return (
    <div className="space-y-6">
      <Section title={tx("title", "Harness History")}>
        <p className="mb-3 text-base leading-relaxed text-codezal-mute">
          {tx(
            "hint",
            "Search your past conversations from other AI coding tools in one place. Read-only — nothing leaves your machine.",
          )}
        </p>

        <div className="mb-4 rounded-lg border border-codezal bg-codezal-panel-2 px-3 py-2.5 text-base text-codezal-mute">
          {tx("disclosure", "Read-only access to these local folders. No data is uploaded.")}
          <div className="mt-1 font-mono text-codezal-dim">
            ~/.claude · ~/.codex · ~/.local/share/opencode · Cursor
          </div>
        </div>

        <div className="mb-3 space-y-2">
          {(["claude-code", "codex", "opencode", "cursor"] as SelectableHarness[]).map((h) => (
            <label key={h} className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={picked[h]}
                onChange={(e) => setPicked((p) => ({ ...p, [h]: e.target.checked }))}
              />
              <span className="text-codezal-text">{HARNESS_LABEL[h]}</span>
              {h === "cursor" && (
                <span className="text-base text-codezal-mute">{tx("experimental", "(experimental)")}</span>
              )}
            </label>
          ))}
        </div>

        <label className="mb-3 flex items-center gap-2 text-base">
          <input
            type="checkbox"
            checked={semantic}
            disabled={!embedCfg}
            onChange={(e) => setSemantic(e.target.checked)}
          />
          <span className={cn("text-codezal-text", !embedCfg && "opacity-50")}>
            {tx("semantic", "Semantic search (embeddings)")}
          </span>
          {!embedCfg && (
            <span className="text-base text-codezal-mute">
              {tx("semanticNeedCfg", "— set an embedding model in the Semantic tab")}
            </span>
          )}
        </label>

        {error && <div className="mb-2 text-base text-destructive">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={indexing}
            onClick={() => void onIndex()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-codezal px-3 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-4 w-4", indexing && "animate-spin")} />
            {totalThreads > 0
              ? tx("reindexBtn", "Re-scan")
              : tx("indexBtn", "Scan history")}
          </button>
          <span className="text-base text-codezal-mute">
            {result
              ? tx("indexedN", "indexed") +
                `: ${result.indexed} · ${tx("skippedN", "skipped")}: ${result.skipped}` +
                (result.removed ? ` · ${tx("removedN", "removed")}: ${result.removed}` : "")
              : totalThreads > 0
                ? `${totalThreads} ${tx("threadsN", "threads")}`
                : ""}
          </span>
        </div>
        {embedProgress && (
          <div className="mt-2 text-base text-codezal-dim">
            {tx("embedding", "Embedding")}: {embedProgress.done}/{embedProgress.total}
          </div>
        )}
      </Section>

      <Section title={tx("searchTitle", "Search")}>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-codezal-mute" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={tx("searchPh", "Find the thread where we…")}
            className="w-full rounded-md border border-codezal bg-codezal-input py-2 pl-9 pr-3 text-base text-codezal-text outline-none focus:border-codezal-accent"
          />
        </div>

        {searching && <div className="text-base text-codezal-mute">{tx("searching", "Searching…")}</div>}
        {!searching && query.trim() && hits.length === 0 && (
          <div className="text-base text-codezal-mute">{tx("noHits", "No matching threads.")}</div>
        )}

        <ul className="space-y-2">
          {hits.map((h) => (
            <li
              key={h.threadId}
              className="rounded-lg border border-codezal bg-codezal-panel-2 px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => void toggleOpen(h.threadId)}
                className="flex w-full flex-col gap-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-base font-medium text-codezal-dim">
                    {HARNESS_LABEL[h.harness] ?? h.harness}
                  </span>
                  <span className="truncate text-base font-medium text-codezal-text">{h.title}</span>
                </div>
                <div className="truncate text-base text-codezal-mute">{h.snippet}</div>
                <div className="flex items-center gap-2 text-base text-codezal-dim">
                  {h.projectPath && <span className="truncate font-mono">{h.projectPath}</span>}
                  {h.updatedAt && <span>· {new Date(h.updatedAt).toLocaleDateString()}</span>}
                </div>
              </button>

              {openId === h.threadId && (
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto border-t border-codezal-hair pt-2">
                  {openMsgs.map((m, i) => (
                    <div key={i} className="text-base">
                      <span
                        className={cn(
                          "mr-1.5 font-medium",
                          m.role === "user" ? "text-codezal-accent" : "text-codezal-dim",
                        )}
                      >
                        {m.role}:
                      </span>
                      <span className="whitespace-pre-wrap text-codezal-text">
                        {m.text.length > 600 ? m.text.slice(0, 600) + "…" : m.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
