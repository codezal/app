import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, ChevronRight, MoreVertical, Pencil, Plus, RefreshCcw, Trash2, X } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { openUrl } from "@tauri-apps/plugin-opener"
import { errorMessage } from "@/lib/errors"
import { authenticateMcp, finishMcpAuth, listMcpStatus, McpLoopbackUnavailableError, onMcpToolsChanged, parseMcpServersJson, removeMcpAuth, startMcpAuth, type McpServerConfig, type McpStatus } from "@/lib/mcp"
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcp-catalog"
import { Segmented, Toggle } from "./primitives"

function RowMenu({
  items,
}: {
  items: { label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden cz-menu p-1"
        >
          {items.map((it, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-md",
                it.danger
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-codezal-text hover:bg-codezal-panel-2",
              )}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function uniqueName(servers: McpServerConfig[], base: string): string {
  const taken = new Set(servers.map((s) => s.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function McpTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const servers = settings.mcpServers ?? []
  const [statuses, setStatuses] = useState<McpStatus[]>([])
  const [testing, setTesting] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [editing, setEditing] = useState<{ idx: number | null; draft: McpServerConfig } | null>(
    null,
  )
  // OAuth flow state. authFor = server name whose paste panel is open;
  // authUrl = the callback URL the user pastes back; authBusy = name being
  // processed; authErr/pendingAuthUrl keyed by server name.
  const [authFor, setAuthFor] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState("")
  const [authBusy, setAuthBusy] = useState<string | null>(null)
  const [authErr, setAuthErr] = useState<Record<string, string>>({})
  const [pendingAuthUrl, setPendingAuthUrl] = useState<Record<string, string>>({})

  // Manual fallback: open the browser and reveal the callback-URL paste panel.
  async function startManualAuth(s: McpServerConfig) {
    const r = await startMcpAuth(s)
    if (r.authed) {
      await testAll()
      return
    }
    if (r.authorizationUrl) {
      setPendingAuthUrl((p) => ({ ...p, [s.name]: r.authorizationUrl! }))
      setAuthFor(s.name)
      setAuthUrl("")
      try {
        await openUrl(r.authorizationUrl)
      } catch {
        // Browser open failed — the panel still shows a manual "open" link.
      }
    }
  }

  async function handleAuthenticate(s: McpServerConfig) {
    setAuthBusy(s.name)
    setAuthErr((p) => ({ ...p, [s.name]: "" }))
    try {
      // Preferred path: auto-capture via the loopback server — opens the browser
      // and resolves once the provider redirects back, no manual paste needed.
      const st = await authenticateMcp(s)
      setStatuses((prev) => [...prev.filter((x) => x.name !== s.name), st])
      setAuthFor(null)
      setAuthUrl("")
    } catch (e) {
      if (e instanceof McpLoopbackUnavailableError) {
        // Loopback port unavailable — fall back to manual callback-URL paste.
        try {
          await startManualAuth(s)
        } catch (e2) {
          setAuthErr((p) => ({ ...p, [s.name]: errorMessage(e2) }))
        }
      } else {
        setAuthErr((p) => ({ ...p, [s.name]: errorMessage(e) }))
      }
    } finally {
      setAuthBusy(null)
    }
  }

  async function handleFinishAuth(s: McpServerConfig) {
    setAuthBusy(s.name)
    setAuthErr((p) => ({ ...p, [s.name]: "" }))
    try {
      const st = await finishMcpAuth(s, authUrl)
      setStatuses((prev) => {
        const rest = prev.filter((x) => x.name !== s.name)
        return [...rest, st]
      })
      setAuthFor(null)
      setAuthUrl("")
    } catch (e) {
      setAuthErr((p) => ({ ...p, [s.name]: errorMessage(e) }))
    } finally {
      setAuthBusy(null)
    }
  }

  async function handleSignOut(s: McpServerConfig) {
    await removeMcpAuth(s.name)
    await testAll()
  }

  // Live-refresh status when a connected server fires tools/list_changed.
  // Re-subscribe on `servers` change so testAll() always closes over the
  // current list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onMcpToolsChanged(() => void testAll()), [servers])

  useEffect(() => {
    const hasUntested = servers.some(
      (s) =>
        s.enabled !== false &&
        (s.transport === "stdio" ? !!s.command : !!s.url) &&
        !statuses.some((st) => st.name === s.name),
    )
    if (hasUntested) void testAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers])

  function applyImport(parsed: McpServerConfig[], mode: "merge" | "replace") {
    const next =
      mode === "replace"
        ? parsed
        : (() => {
            const byName = new Map<string, McpServerConfig>()
            for (const s of servers) byName.set(s.name, s)
            for (const s of parsed) byName.set(s.name, s)
            return Array.from(byName.values())
          })()
    void update({ mcpServers: next })
    setImportOpen(false)
  }

  const nameCounts = servers.reduce<Record<string, number>>((acc, s) => {
    if (s.name) acc[s.name] = (acc[s.name] ?? 0) + 1
    return acc
  }, {})

  function patchAt(idx: number, patch: Partial<McpServerConfig>) {
    const next = servers.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    void update({ mcpServers: next })
  }
  function removeAt(idx: number) {
    void update({ mcpServers: servers.filter((_, i) => i !== idx) })
  }

  function addFromCatalog(e: McpCatalogEntry) {
    if (servers.some((s) => s.url === e.url || s.name === e.name)) return
    void update({
      mcpServers: [...servers, { name: e.name, url: e.url, transport: "http" as const }],
    })
  }
  const catalogInstalled = new Set(servers.map((s) => s.url))
  function addNew() {
    setEditing({
      idx: null,
      draft: { name: uniqueName(servers, "yeni"), url: "", transport: "http", enabled: true },
    })
  }
  function addStdio() {
    setEditing({
      idx: null,
      draft: {
        name: uniqueName(servers, "yeni-stdio"),
        url: "",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"],
        enabled: true,
      },
    })
  }
  function commitEdit(cfg: McpServerConfig) {
    if (!editing) return
    const next =
      editing.idx === null
        ? [...servers, cfg]
        : servers.map((s, i) => (i === editing.idx ? cfg : s))
    void update({ mcpServers: next })
    setEditing(null)
  }

  async function testAll() {
    setTesting(true)
    try {
      const s = await listMcpStatus(
        servers.filter((x) => {
          if (x.enabled === false) return false
          return x.transport === "stdio" ? !!x.command : !!x.url
        }),
      )
      setStatuses(s)
    } finally {
      setTesting(false)
    }
  }

  function statusFor(name: string): McpStatus | undefined {
    return statuses.find((s) => s.name === name)
  }

  function toggleExpand(name: string) {
    setExpanded((p) => ({ ...p, [name]: !p[name] }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-semibold tracking-tight text-codezal-text">
            {t("settings.drawer.mcpServersTitle")}
          </h3>
          <p className="mt-0.5 text-md leading-relaxed text-codezal-mute">
            {t("settings.drawer.mcpHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddSheetOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-codezal-text px-3 py-1.5 text-md font-medium text-codezal-bg hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Sunucu ekle
        </button>
      </div>

      {/* Sunucu listesi — native macOS gruplu inset liste */}
      {servers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-codezal px-3 py-10 text-center text-md text-codezal-mute">
          {t("settings.drawer.mcpNoServers")}
        </div>
      ) : (
        <ul className="divide-y divide-codezal-hair rounded-lg border border-codezal bg-codezal-panel">
            {servers.map((s, i) => {
              const st = statusFor(s.name)
              const stdio = (s.transport ?? "http") === "stdio"
              const dot =
                  s.enabled === false
                    ? "bg-zinc-300 dark:bg-zinc-600"
                    : st?.ok
                      ? "bg-emerald-500"
                      : st?.needsAuth
                        ? "bg-amber-400"
                        : st?.error
                          ? "bg-red-500"
                          : "bg-zinc-300 dark:bg-zinc-600"
                const menuItems: {
                  label: string
                  onClick: () => void
                  danger?: boolean
                  icon?: React.ReactNode
                }[] = [
                  {
                    label: t("common.edit"),
                    icon: <Pencil className="h-3.5 w-3.5" />,
                    onClick: () => setEditing({ idx: i, draft: { ...s } }),
                  },
                  ...(st?.authed && !st.needsAuth
                    ? [
                        {
                          label: t("settings.drawer.mcpSignOut"),
                          onClick: () => void handleSignOut(s),
                        },
                      ]
                    : []),
                  {
                    label: t("settings.drawer.mcpDeleteTitle"),
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    danger: true,
                    onClick: () => removeAt(i),
                  },
                ]
                return (
                  <li key={`${s.name || "mcp"}-${i}`} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-md font-medium",
                              !s.name || nameCounts[s.name] > 1
                                ? "text-destructive"
                                : "text-codezal-text",
                            )}
                            title={
                              !s.name
                                ? t("settings.drawer.mcpNameEmptyTitle")
                                : nameCounts[s.name] > 1
                                  ? t("settings.drawer.mcpNameDuplicateTitle")
                                  : s.name
                            }
                          >
                            {s.name || "—"}
                          </span>
                          <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-md font-medium uppercase tracking-wide text-codezal-dim">
                            {s.transport ?? "http"}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 truncate font-mono text-md text-codezal-mute"
                          title={
                            stdio
                              ? `${s.command ?? ""} ${(s.args ?? []).join(" ")}`.trim()
                              : s.url
                          }
                        >
                          {stdio
                            ? `${s.command ?? ""} ${(s.args ?? []).join(" ")}`.trim()
                            : s.url}
                        </div>
                      </div>
                      {st && !st.needsAuth && (
                        <button
                          type="button"
                          onClick={() => st.ok && toggleExpand(s.name)}
                          disabled={!st.ok}
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-md",
                            st.ok
                              ? "bg-codezal-accent-dim text-codezal-text hover:opacity-80"
                              : "cursor-default bg-destructive/15 text-destructive",
                          )}
                          title={st.error ?? (st.ok ? t("settings.drawer.mcpToolListTitle") : "")}
                        >
                          {st.ok &&
                            (expanded[s.name] ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ))}
                          {st.ok ? `${st.toolCount} tool` : t("messageList.errorLabel")}
                        </button>
                      )}
                      {st?.needsAuth && (
                        <button
                          type="button"
                          onClick={() => void handleAuthenticate(s)}
                          disabled={authBusy === s.name}
                          className="flex shrink-0 items-center gap-1 rounded bg-codezal-text px-2.5 py-1 text-md font-medium text-codezal-bg hover:opacity-90 disabled:opacity-50"
                        >
                          {authBusy === s.name
                            ? t("settings.drawer.mcpAuthOpening")
                            : t("settings.drawer.mcpAuthenticate")}
                        </button>
                      )}
                      <Toggle
                        label={t("settings.drawer.mcpEnabledLabel")}
                        checked={s.enabled !== false}
                        onChange={(v) => patchAt(i, { enabled: v })}
                      />
                      <RowMenu items={menuItems} />
                    </div>
                  {st?.error && !st.needsAuth && (
                    <div className="mt-1 text-md text-destructive">{st.error}</div>
                  )}
                  {st?.ok && expanded[s.name] && st.tools && st.tools.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-md border border-codezal/60 bg-codezal-panel-2/60 p-2 text-md">
                      {st.tools.map((ti) => (
                        <li key={ti.name} className="flex flex-col">
                          <code className="text-codezal-accent">
                            {s.name}__{ti.name}
                          </code>
                          {ti.description && (
                            <span className="ml-2 line-clamp-2 text-codezal-mute">
                              {ti.description}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {st?.ok && (!!st.promptCount || !!st.resourceCount) && (
                    <div className="mt-1 text-md text-codezal-mute">
                      {t("settings.drawer.mcpCapsCounts", {
                        prompts: st.promptCount ?? 0,
                        resources: st.resourceCount ?? 0,
                      })}
                    </div>
                  )}
                  {authFor === s.name && (
                    <div className="mt-2 rounded border border-codezal-accent/40 bg-codezal-panel-2/60 p-2">
                      <div className="mb-1 text-md font-medium text-codezal-text">
                        {t("settings.drawer.mcpAuthPasteTitle")}
                      </div>
                      <p className="mb-1.5 text-md leading-relaxed text-codezal-mute">
                        {t("settings.drawer.mcpAuthPasteHint")}
                      </p>
                      {pendingAuthUrl[s.name] && (
                        <button
                          type="button"
                          onClick={() => void openUrl(pendingAuthUrl[s.name]).catch(() => {})}
                          className="mb-1.5 block max-w-full truncate text-left font-mono text-md text-codezal-accent hover:underline"
                          title={pendingAuthUrl[s.name]}
                        >
                          {pendingAuthUrl[s.name]}
                        </button>
                      )}
                      <input
                        value={authUrl}
                        onChange={(e) => setAuthUrl(e.target.value)}
                        placeholder={t("settings.drawer.mcpAuthPastePlaceholder")}
                        className="mb-1.5 w-full rounded-md border border-codezal bg-transparent px-2.5 py-1.5 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleFinishAuth(s)}
                          disabled={authBusy === s.name || !authUrl.trim()}
                          className="rounded bg-codezal-accent px-2.5 py-1 text-md font-medium text-codezal-bg hover:opacity-90 disabled:opacity-50"
                        >
                          {t("settings.drawer.mcpAuthFinishBtn")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAuthFor(null)
                            setAuthUrl("")
                          }}
                          className="rounded border border-codezal px-2.5 py-1 text-md text-codezal-dim hover:text-codezal-text"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {authErr[s.name] && (
                    <div className="mt-1 text-md text-destructive">
                      {t("settings.drawer.mcpAuthFailed")}: {authErr[s.name]}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

      {/* Footer: test + durum */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void testAll()}
          disabled={testing || servers.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-4 w-4", testing && "animate-spin")} />
          {t("settings.drawer.mcpTestConnection")}
        </button>
        {statuses.length > 0 && !testing && (
          <span className="flex items-center gap-1 text-md text-codezal-dim">
            <Check className="h-4 w-4 text-codezal-accent" />
            {statuses.filter((s) => s.ok).length}/{statuses.length} ok
          </span>
        )}
      </div>

      {addSheetOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddSheetOpen(false)
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-codezal-hair px-5 py-4">
              <h3 className="text-md font-semibold tracking-tight text-codezal-text">Sunucu ekle</h3>
              <button
                type="button"
                onClick={() => setAddSheetOpen(false)}
                className="rounded-md p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
              <div>
                <div className="mb-2 text-md font-medium text-codezal-text">Hazır sunucular</div>
                <ul className="divide-y divide-codezal-hair overflow-hidden rounded-lg border border-codezal">
                  {MCP_CATALOG.map((e) => {
                    const installed = catalogInstalled.has(e.url)
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          disabled={installed}
                          onClick={() => {
                            addFromCatalog(e)
                            setAddSheetOpen(false)
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-codezal-panel-2 disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-md font-medium text-codezal-text">{e.name}</span>
                              <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-md font-medium uppercase tracking-wide text-codezal-dim">
                                {e.category}
                              </span>
                            </div>
                            <p className="truncate text-md text-codezal-mute">{e.description}</p>
                          </div>
                          {installed ? (
                            <Check className="h-4 w-4 shrink-0 text-codezal-accent" />
                          ) : (
                            <Plus className="h-4 w-4 shrink-0 text-codezal-mute" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div>
                <div className="mb-2 text-md font-medium text-codezal-text">Özel</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddSheetOpen(false)
                      addNew()
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
                  >
                    <Plus className="h-4 w-4" /> {t("settings.drawer.mcpHttpAdd")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddSheetOpen(false)
                      addStdio()
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
                  >
                    <Plus className="h-4 w-4" /> {t("settings.drawer.mcpStdioAdd")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddSheetOpen(false)
                      setImportOpen(true)
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
                  >
                    <Plus className="h-4 w-4" /> {t("settings.drawer.mcpImportTitle")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <McpImportModal
          onClose={() => setImportOpen(false)}
          onApply={applyImport}
        />
      )}

      {editing && (
        <McpEditModal
          initial={editing.draft}
          isNew={editing.idx === null}
          existingNames={servers.filter((_, i) => i !== editing.idx).map((x) => x.name)}
          onSave={commitEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

const MCP_IMPORT_TEMPLATE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"]
    },
    "remote": {
      "url": "https://mcp.example.com/v1/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}`

function McpImportModal({
  onClose,
  onApply,
}: {
  onClose: () => void
  onApply: (parsed: McpServerConfig[], mode: "merge" | "replace") => void
}) {
  const t = useT()
  const [text, setText] = useState(MCP_IMPORT_TEMPLATE)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<McpServerConfig[]>(() => {
    try {
      return parseMcpServersJson(MCP_IMPORT_TEMPLATE)
    } catch {
      return []
    }
  })
  const [mode, setMode] = useState<"merge" | "replace">("merge")

  function tryParse(t: string) {
    setText(t)
    if (!t.trim()) {
      setError(null)
      setPreview([])
      return
    }
    try {
      const parsed = parseMcpServersJson(t)
      setError(null)
      setPreview(parsed)
    } catch (e) {
      setError(errorMessage(e))
      setPreview([])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-[560px] flex-col gap-3 rounded-xl border border-codezal bg-codezal-panel p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="mb-2 text-md font-semibold uppercase tracking-wider text-codezal-dim">
            {t("settings.drawer.mcpImportTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-md text-codezal-mute">
          {t("settings.drawer.mcpImportHint")}
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => tryParse(e.target.value)}
          placeholder={MCP_IMPORT_TEMPLATE}
          rows={12}
          className="w-full rounded-md border border-codezal bg-codezal-input px-2 py-1.5 font-mono text-md text-codezal-text outline-none focus:border-codezal-strong"
        />
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-md text-destructive">
            {error}
          </div>
        )}
        {preview.length > 0 && (
          <div className="rounded-md border border-codezal bg-codezal-panel-2/60 px-2 py-1.5 text-md">
            <div className="mb-1 text-codezal-dim">
              {t("settings.drawer.mcpImportServerCount").replace("{count}", String(preview.length))}
            </div>
            <ul className="space-y-0.5">
              {preview.map((p) => (
                <li key={p.name} className="font-mono text-codezal-text">
                  · {p.name}{" "}
                  <span className="text-codezal-mute">
                    [{p.transport ?? "http"}]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-md text-codezal-dim">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            {t("settings.drawer.mcpImportModeMerge")}
          </label>
          <label className="flex items-center gap-1.5 text-md text-codezal-dim">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            {t("settings.drawer.mcpImportModeReplace")}
          </label>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-codezal px-2.5 py-1 text-md text-codezal-dim hover:text-codezal-text"
          >
            {t("settings.drawer.mcpImportCancelBtn")}
          </button>
          <button
            type="button"
            disabled={preview.length === 0}
            onClick={() => onApply(preview, mode)}
            className="rounded-md border border-codezal-accent bg-codezal-accent-dim px-2.5 py-1 text-md text-codezal-accent disabled:opacity-50"
          >
            {t("settings.drawer.mcpImportApplyBtn").replace("{count}", String(preview.length))}
          </button>
        </div>
      </div>
    </div>
  )
}

function McpEditModal({
  initial,
  isNew,
  existingNames,
  onSave,
  onClose,
}: {
  initial: McpServerConfig
  isNew: boolean
  existingNames: string[]
  onSave: (cfg: McpServerConfig) => void
  onClose: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState<McpServerConfig>(initial)
  const transport = draft.transport ?? "http"
  const stdio = transport === "stdio"
  const nameTrim = draft.name.trim()
  const dup = existingNames.map((n) => n.trim()).includes(nameTrim)
  const invalid = !nameTrim || dup || (stdio ? !(draft.command ?? "").trim() : !draft.url.trim())

  function patch(p: Partial<McpServerConfig>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-codezal-hair px-5 py-4">
          <h3 className="text-md font-semibold tracking-tight text-codezal-text">
            {isNew
              ? stdio
                ? t("settings.drawer.mcpStdioAdd")
                : t("settings.drawer.mcpHttpAdd")
              : t("common.edit")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t("settings.drawer.mcpNamePlaceholder")}
              className={cn(
                "w-full rounded-lg border bg-codezal-input px-3 py-2 text-md text-codezal-text outline-none focus:border-codezal-accent",
                !nameTrim || dup ? "border-destructive" : "border-codezal",
              )}
            />
            {dup && (
              <div className="text-md text-destructive">
                {t("settings.drawer.mcpNameDuplicateTitle")}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Segmented
                value={transport}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "sse", label: "SSE" },
                  { value: "stdio", label: "stdio" },
                ]}
                onChange={(v) => patch({ transport: v as "http" | "sse" | "stdio" })}
              />
              <div className="flex items-center gap-2 text-md text-codezal-dim">
                <span>{t("settings.drawer.mcpEnabledLabel")}</span>
                <Toggle
                  label={t("settings.drawer.mcpEnabledLabel")}
                  checked={draft.enabled !== false}
                  onChange={(v) => patch({ enabled: v })}
                />
              </div>
            </div>
          </div>

          {stdio ? (
            <>
              <div className="flex gap-2">
                <input
                  value={draft.command ?? ""}
                  onChange={(e) => patch({ command: e.target.value })}
                  placeholder="npx | uvx | node | …"
                  className="w-[120px] rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
                />
                <input
                  value={(draft.args ?? []).join(" ")}
                  onChange={(e) => patch({ args: e.target.value.split(/\s+/).filter(Boolean) })}
                  placeholder="-y @modelcontextprotocol/server-filesystem $HOME"
                  className="flex-1 rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
                />
              </div>
              <textarea
                value={JSON.stringify(draft.env ?? {}, null, 0)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value || "{}")
                    if (parsed && typeof parsed === "object") {
                      patch({ env: parsed as Record<string, string> })
                    }
                  } catch {
                    // Intentionally ignored.
                  }
                }}
                placeholder={t("settings.drawer.mcpEnvPlaceholder")}
                rows={3}
                className="w-full resize-none rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-dim outline-none focus:border-codezal-accent"
              />
            </>
          ) : (
            <>
              <input
                value={draft.url}
                onChange={(e) => patch({ url: e.target.value })}
                placeholder={t("settings.drawer.mcpUrlPlaceholder")}
                className="w-full rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
              <textarea
                value={JSON.stringify(draft.headers ?? {}, null, 0)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value || "{}")
                    if (parsed && typeof parsed === "object") {
                      patch({ headers: parsed as Record<string, string> })
                    }
                  } catch {
                    // Intentionally ignored.
                  }
                }}
                placeholder={t("settings.drawer.mcpHeadersPlaceholder")}
                rows={3}
                className="w-full resize-none rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-dim outline-none focus:border-codezal-accent"
              />
              <input
                type="number"
                min={1000}
                value={draft.timeout ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  patch({ timeout: Number.isFinite(n) && n > 0 ? n : undefined })
                }}
                placeholder={t("settings.drawer.mcpTimeoutPlaceholder")}
                className="w-[180px] rounded-lg border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-dim outline-none focus:border-codezal-accent"
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-codezal-hair px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={invalid}
            onClick={() => onSave({ ...draft, name: nameTrim })}
            className="rounded-md bg-codezal-text px-3.5 py-1.5 text-md font-medium text-codezal-bg hover:opacity-90 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  )
}

