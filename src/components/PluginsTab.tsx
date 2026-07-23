import { useEffect, useState } from "react"
import {
  ExternalLink,
  Plus,
  RefreshCcw,
  ScrollText,
  Shield,
  ShieldAlert,
  Trash2,
} from "@/lib/icons"
import {
  addMarketplace,
  clearAudit,
  DEFAULT_MARKETPLACE_ID,
  installPlugin,
  pullMarketplace,
  readAudit,
  readInstalled,
  readMarketplaceIndex,
  readMarketplacePluginManifest,
  readMarketplaces,
  removeMarketplace,
  togglePluginEnabled,
  uninstallPlugin,
  type AuditEntry,
  type InstalledPlugin,
  type MarketplaceIndex,
  type MarketplaceIndexEntry,
  type MarketplacePluginManifest,
  type RegisteredMarketplace,
} from "@/lib/plugins"
import { PluginInstallApproval } from "./PluginInstallApproval"
import { cn } from "@/lib/utils"
import { toast } from "@/store/toast"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useT } from "@/lib/i18n/useT"
import { Section, Toggle } from "./settings/primitives"

export function PluginsTab() {
  const t = useT()
  const [marketplaces, setMarketplaces] = useState<RegisteredMarketplace[]>([])
  const [selectedMpId, setSelectedMpId] = useState<string | null>(null)
  const [index, setIndex] = useState<MarketplaceIndex | null>(null)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [busy, setBusy] = useState(false)
  // Errors also surface inline in the install-approval modal (via `error`);
  // all status feedback routes to a global toast. Success → toast only.
  const [error, setErrorState] = useState<string | null>(null)
  const setError = (m: string | null) => {
    setErrorState(m)
    if (m) toast.error(m)
  }
  const setInfo = (m: string | null) => {
    if (m) toast.success(m)
  }
  const [newUrl, setNewUrl] = useState("")
  const [filter, setFilter] = useState<"all" | "codezal-curated" | "community">("all")
  const [approvalManifest, setApprovalManifest] = useState<
    | { mp: RegisteredMarketplace; manifest: MarketplacePluginManifest }
    | null
  >(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [audit, setAudit] = useState<AuditEntry[]>([])

  async function refresh() {
    const [mps, inst] = await Promise.all([readMarketplaces(), readInstalled()])
    setMarketplaces(mps.marketplaces)
    setInstalled(inst.plugins)
    if (mps.marketplaces.length > 0 && !selectedMpId) {
      setSelectedMpId(mps.marketplaces[0].id)
    }
  }

  useEffect(() => {
    void (async () => {
      await refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // setState yerine; adjust-state-during-render).
  const [prevSelMp, setPrevSelMp] = useState(selectedMpId)
  if (selectedMpId !== prevSelMp) {
    setPrevSelMp(selectedMpId)
    if (!selectedMpId) setIndex(null)
  }
  useEffect(() => {
    if (!selectedMpId) return
    const mp = marketplaces.find((m) => m.id === selectedMpId)
    if (!mp) return
    void readMarketplaceIndex(mp.localPath)
      .then(setIndex)
      .catch((e) => setError(t("pluginsTab.indexReadFailed", { message: (e as Error).message })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMpId, marketplaces])

  async function handleAdd() {
    if (!newUrl.trim()) return
    setBusy(true)
    setError(null)
    try {
      const mp = await addMarketplace(newUrl.trim())
      setNewUrl("")
      setInfo(t("pluginsTab.marketplaceAdded", { name: mp.name }))
      setSelectedMpId(mp.id)
      await refresh()
    } catch (e) {
      setError(t("pluginsTab.marketplaceAddFailed", { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMp(id: string) {
    if (!(await confirm(t("pluginsTab.removeMarketplaceConfirm")))) return
    setBusy(true)
    try {
      await removeMarketplace(id)
      if (selectedMpId === id) setSelectedMpId(null)
      await refresh()
      setInfo(t("pluginsTab.marketplaceRemoved"))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handlePull(mp: RegisteredMarketplace) {
    setBusy(true)
    setError(null)
    try {
      await pullMarketplace(mp.localPath, mp.url)
      // Trigger re-read
      setSelectedMpId(null)
      setTimeout(() => setSelectedMpId(mp.id), 50)
      setInfo(t("pluginsTab.marketplaceUpdated"))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleInstallClick(entry: MarketplaceIndexEntry) {
    const mp = marketplaces.find((m) => m.id === selectedMpId)
    if (!mp) return
    setBusy(true)
    setError(null)
    try {
      const m = await readMarketplacePluginManifest(mp.localPath, entry.manifestPath)
      setApprovalManifest({ mp, manifest: m })
    } catch (e) {
      setError(t("pluginsTab.manifestReadFailed", { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function handleInstallConfirm() {
    if (!approvalManifest) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const installed = await installPlugin({
        marketplaceId: approvalManifest.mp.id,
        marketplaceLocalPath: approvalManifest.mp.localPath,
        manifest: approvalManifest.manifest,
      })
      console.info("[PluginsTab] install OK:", installed.id)
      setInfo(t("pluginsTab.installedToast", { name: approvalManifest.manifest.name }))
      setApprovalManifest(null)
      await refresh()
    } catch (e) {
      const msg = (e as Error).message || String(e)
      console.error("[PluginsTab] install fail:", e)
      setError(t("pluginsTab.installFailed", { message: msg }))
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(p: InstalledPlugin) {
    setBusy(true)
    try {
      await togglePluginEnabled(p.id, !p.enabled)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleUninstall(p: InstalledPlugin) {
    if (!(await confirm(t("pluginsTab.uninstallConfirm", { name: p.name })))) return
    setBusy(true)
    try {
      await uninstallPlugin(p.id)
      await refresh()
      setInfo(t("pluginsTab.uninstalledToast", { name: p.name }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAudit() {
    const next = !auditOpen
    setAuditOpen(next)
    if (next) setAudit(await readAudit(200))
  }

  async function handleClearAudit() {
    if (!(await confirm(t("pluginsTab.clearAuditConfirm")))) return
    await clearAudit()
    setAudit([])
  }

  const filteredEntries =
    index?.plugins.filter((p) => filter === "all" || p.channel === filter) ?? []
  const installedById = new Map(installed.map((p) => [p.id, p]))
  const catalogIds = new Set(index?.plugins.map((e) => e.id) ?? [])
  const mergedPlugins: {
    id: string
    name: string
    verified: boolean
    channel: string
    entry: MarketplaceIndexEntry | null
    plugin: InstalledPlugin | null
  }[] = [
    ...filteredEntries.map((e) => ({
      id: e.id,
      name: e.name,
      verified: e.verified,
      channel: e.channel,
      entry: e,
      plugin: installedById.get(e.id) ?? null,
    })),
    ...installed
      .filter((p) => !catalogIds.has(p.id) && (filter === "all" || p.channel === filter))
      .map((p) => ({
        id: p.id,
        name: p.name,
        verified: false,
        channel: p.channel,
        entry: null,
        plugin: p,
      })),
  ]

  function auditLabel(ev: AuditEntry["event"]): { text: string; cls: string } {
    switch (ev) {
      case "install":
        return { text: t("pluginsTab.evInstall"), cls: "text-codezal-accent" }
      case "uninstall":
        return { text: t("pluginsTab.evUninstall"), cls: "text-codezal-mute" }
      case "enable":
        return { text: t("pluginsTab.evEnable"), cls: "text-codezal-accent" }
      case "disable":
        return { text: t("pluginsTab.evDisable"), cls: "text-codezal-mute" }
      case "update":
        return { text: t("pluginsTab.evUpdate"), cls: "text-codezal-accent" }
      case "permission-deny":
        return { text: t("pluginsTab.evPermissionDeny"), cls: "text-destructive" }
      case "network-deny":
        return { text: t("pluginsTab.evNetworkDeny"), cls: "text-destructive" }
      case "signature-verify":
        return { text: t("pluginsTab.evSignatureVerify"), cls: "text-codezal-accent" }
      case "signature-fail":
        return { text: t("pluginsTab.evSignatureFail"), cls: "text-destructive" }
      case "marketplace-add":
        return { text: t("pluginsTab.evMarketplaceAdd"), cls: "text-codezal-text" }
      case "marketplace-remove":
        return { text: t("pluginsTab.evMarketplaceRemove"), cls: "text-codezal-mute" }
      default:
        return { text: ev, cls: "text-codezal-mute" }
    }
  }

  function fmtTs(ts: number): string {
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return String(ts)
    }
  }

  return (
    <div className="space-y-6">
      {/* Marketplace ekle */}
      <Section title={t("pluginsTab.addMarketplace")}>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder={t("pluginsTab.marketplaceUrlPlaceholder")}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="flex-1 rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-1.5 text-base text-codezal-text outline-none focus:border-codezal-accent"
          />
          <button
            type="button"
            disabled={busy || !newUrl.trim()}
            onClick={() => void handleAdd()}
            className="flex shrink-0 items-center gap-1 rounded-md bg-codezal-text px-3 py-1.5 text-base font-medium text-codezal-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> {t("common.add")}
          </button>
        </div>
        <p className="mt-1.5 text-base text-codezal-mute">
          {t("pluginsTab.marketplaceAddHint")}
        </p>
      </Section>

      {/* Marketplace listesi */}
      {marketplaces.length > 0 && (
        <section>
          <h3 className="mb-3 text-md font-semibold tracking-tight text-codezal-text">
            {t("pluginsTab.marketplaces", { count: marketplaces.length })}
          </h3>
          <ul className="divide-y divide-codezal-hair rounded-lg border border-codezal bg-codezal-panel">
            {marketplaces.map((mp) => (
              <li
                key={mp.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  selectedMpId === mp.id && "bg-codezal-panel-2/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedMpId(mp.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-base font-medium text-codezal-text">{mp.name}</div>
                  <div className="truncate font-mono text-base text-codezal-mute">{mp.url}</div>
                </button>
                <button
                  type="button"
                  onClick={() => void handlePull(mp)}
                  disabled={busy}
                  title={t("pluginsTab.pull")}
                  className="shrink-0 rounded-md p-1.5 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
                >
                  <RefreshCcw className="h-4 w-4" />
                </button>
                {mp.id !== DEFAULT_MARKETPLACE_ID && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveMp(mp.id)}
                    disabled={busy}
                    title={t("common.remove")}
                    className="shrink-0 rounded-md p-1.5 text-codezal-mute hover:bg-codezal-panel-2 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Eklentiler — katalog + kurulu tek liste */}
      {(index || installed.length > 0) && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-md font-semibold tracking-tight text-codezal-text">
              {index
                ? t("pluginsTab.pluginCount", { name: index.name, count: mergedPlugins.length })
                : t("pluginsTab.installedSection", { count: installed.length })}
            </h3>
            {index && (
              <div className="inline-flex items-center gap-1 rounded-md bg-codezal-panel-2 p-0.5 text-base">
                {(["all", "codezal-curated", "community"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilter(c)}
                    className={cn(
                      "rounded px-2.5 py-1 transition-colors",
                      filter === c
                        ? "bg-codezal-panel font-medium text-codezal-text shadow-sm"
                        : "text-codezal-mute hover:text-codezal-text",
                    )}
                  >
                    {c === "all" ? t("settings.modelsPage.filterAll") : c === "codezal-curated" ? t("common.official") : t("common.community")}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mergedPlugins.length === 0 ? (
            <div className="rounded-lg border border-dashed border-codezal px-3 py-8 text-center text-base text-codezal-mute">
              {t("pluginsTab.noInstalled")}
            </div>
          ) : (
            <ul className="divide-y divide-codezal-hair rounded-lg border border-codezal bg-codezal-panel">
              {mergedPlugins.map((m) => {
                const p = m.plugin
                const e = m.entry
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-medium text-codezal-text">{m.name}</span>
                        {m.verified ? (
                          <span title={t("pluginsTab.verifiedTitle")} className="inline-flex shrink-0">
                            <Shield className="h-4 w-4 text-codezal-accent" />
                          </span>
                        ) : (
                          <span title={t("pluginsTab.communityTitle")} className="inline-flex shrink-0">
                            <ShieldAlert className="h-4 w-4 text-yellow-500" />
                          </span>
                        )}
                        {p && (
                          <span className="shrink-0 text-base text-codezal-mute">v{p.version}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-base text-codezal-mute">
                        {p ? (
                          <>
                            {t("pluginsTab.author", { name: p.manifest.author.name })}
                            {/^https?:\/\//i.test(p.manifest.upstream ?? "") && (
                              <>
                                {" · "}
                                <a
                                  href={p.manifest.upstream}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-0.5 hover:text-codezal-accent"
                                >
                                  upstream <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </>
                            )}
                            {" · "}
                            {p.manifest.license}
                            {" · "}
                            {m.channel}
                          </>
                        ) : (
                          m.channel
                        )}
                      </div>
                    </div>
                    {p ? (
                      <>
                        <Toggle
                          label={p.enabled ? t("pluginsTab.disable") : t("pluginsTab.enable")}
                          checked={p.enabled}
                          onChange={() => {
                            if (!busy) void handleToggle(p)
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleUninstall(p)}
                          disabled={busy}
                          title={t("common.remove")}
                          className="shrink-0 rounded-md p-1.5 text-codezal-mute hover:bg-codezal-panel-2 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : e ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleInstallClick(e)}
                        className="shrink-0 rounded-md bg-codezal-text px-3 py-1.5 text-base font-medium text-codezal-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {t("pluginInstall.installBtn")}
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void toggleAudit()}
            className="flex items-center gap-1.5 text-base font-medium text-codezal-text hover:text-codezal-accent"
          >
            <ScrollText className="h-4 w-4" />
            {t("pluginsTab.auditLog")}
            <span className="text-base text-codezal-mute">
              {auditOpen ? t("pluginsTab.auditHide") : t("pluginsTab.auditShow")}
            </span>
          </button>
          {auditOpen && audit.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearAudit()}
              className="text-base text-codezal-mute hover:text-destructive"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
        {auditOpen && (
          <div className="mt-2">
            {audit.length === 0 ? (
              <p className="text-base text-codezal-mute">{t("pluginsTab.noAudit")}</p>
            ) : (
              <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-codezal bg-codezal-panel-2/30 p-2">
                {audit.map((a, i) => {
                  const lbl = auditLabel(a.event)
                  return (
                    <div
                      key={i}
                      className="flex items-baseline gap-2 text-base leading-relaxed"
                    >
                      <span className="shrink-0 font-mono text-codezal-mute">
                        {fmtTs(a.ts)}
                      </span>
                      <span className={cn("shrink-0 font-medium", lbl.cls)}>
                        {lbl.text}
                      </span>
                      <span className="truncate text-codezal-dim">
                        {a.plugin ?? a.marketplace ?? ""}
                        {a.permission ? ` · ${a.permission}` : ""}
                        {a.host ? ` · ${a.host}` : ""}
                        {a.sha ? ` · ${a.sha.slice(0, 8)}` : ""}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="mt-2 text-base text-codezal-mute">
              {t("pluginsTab.auditFooter")}
            </p>
          </div>
        )}
      </section>

      {/* Install onay modal */}
      {approvalManifest && (
        <PluginInstallApproval
          manifest={approvalManifest.manifest}
          marketplaceName={approvalManifest.mp.name}
          onConfirm={() => void handleInstallConfirm()}
          onCancel={() => {
            setApprovalManifest(null)
            setError(null)
          }}
          busy={busy}
          error={error}
        />
      )}
    </div>
  )
}
