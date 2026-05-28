// SettingsDrawer "Eklentiler" sekmesi — marketplace yönetimi, plugin kuruluyu listele.
import { useEffect, useState } from "react"
import {
  Check,
  ExternalLink,
  Plus,
  RefreshCcw,
  Shield,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import {
  addMarketplace,
  installPlugin,
  pullMarketplace,
  readInstalled,
  readMarketplaceIndex,
  readMarketplacePluginManifest,
  readMarketplaces,
  removeMarketplace,
  togglePluginEnabled,
  uninstallPlugin,
  type InstalledPlugin,
  type MarketplaceIndex,
  type MarketplaceIndexEntry,
  type MarketplacePluginManifest,
  type RegisteredMarketplace,
} from "@/lib/plugins"
import { PluginInstallApproval } from "./PluginInstallApproval"
import { cn } from "@/lib/utils"

export function PluginsTab() {
  const [marketplaces, setMarketplaces] = useState<RegisteredMarketplace[]>([])
  const [selectedMpId, setSelectedMpId] = useState<string | null>(null)
  const [index, setIndex] = useState<MarketplaceIndex | null>(null)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState("")
  const [filter, setFilter] = useState<"all" | "codezal-curated" | "community">("all")
  const [approvalManifest, setApprovalManifest] = useState<
    | { mp: RegisteredMarketplace; manifest: MarketplacePluginManifest }
    | null
  >(null)

  async function refresh() {
    const [mps, inst] = await Promise.all([readMarketplaces(), readInstalled()])
    setMarketplaces(mps.marketplaces)
    setInstalled(inst.plugins)
    if (mps.marketplaces.length > 0 && !selectedMpId) {
      setSelectedMpId(mps.marketplaces[0].id)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!selectedMpId) {
      setIndex(null)
      return
    }
    const mp = marketplaces.find((m) => m.id === selectedMpId)
    if (!mp) return
    void readMarketplaceIndex(mp.localPath)
      .then(setIndex)
      .catch((e) => setError(`Index okunamadı: ${(e as Error).message}`))
  }, [selectedMpId, marketplaces])

  async function handleAdd() {
    if (!newUrl.trim()) return
    setBusy(true)
    setError(null)
    try {
      const mp = await addMarketplace(newUrl.trim())
      setNewUrl("")
      setInfo(`Marketplace eklendi: ${mp.name}`)
      setSelectedMpId(mp.id)
      await refresh()
    } catch (e) {
      setError(`Marketplace eklenemedi: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMp(id: string) {
    if (!confirm("Bu marketplace'i kaldırmak istediğine emin misin?")) return
    setBusy(true)
    try {
      await removeMarketplace(id)
      if (selectedMpId === id) setSelectedMpId(null)
      await refresh()
      setInfo("Marketplace kaldırıldı")
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
      await pullMarketplace(mp.localPath)
      // Trigger re-read
      setSelectedMpId(null)
      setTimeout(() => setSelectedMpId(mp.id), 50)
      setInfo("Marketplace güncellendi")
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
      setError(`Manifest okunamadı: ${(e as Error).message}`)
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
      setInfo(`Kuruldu: ${approvalManifest.manifest.name}`)
      setApprovalManifest(null)
      await refresh()
    } catch (e) {
      const msg = (e as Error).message || String(e)
      console.error("[PluginsTab] install fail:", e)
      setError(`Kurulum hatası: ${msg}`)
      // Modal'ı kapatma — kullanıcı hata gördükten sonra İptal'le çıksın
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
    if (!confirm(`"${p.name}" eklentisini kaldır?`)) return
    setBusy(true)
    try {
      await uninstallPlugin(p.id)
      await refresh()
      setInfo(`Kaldırıldı: ${p.name}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const installedIds = new Set(installed.map((p) => p.id))
  const filteredEntries =
    index?.plugins.filter((p) => filter === "all" || p.channel === filter) ?? []

  return (
    <div className="space-y-5">
      {/* Hata/info */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-codezal-accent/30 bg-codezal-accent/10 px-3 py-2 text-[12px] text-codezal-accent">
          {info}
        </div>
      )}

      {/* Marketplace ekle */}
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-codezal-text">Marketplace Ekle</h3>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="flex-1 rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-1.5 text-[12px] text-codezal-text outline-none focus:border-codezal-accent"
          />
          <button
            type="button"
            disabled={busy || !newUrl.trim()}
            onClick={() => void handleAdd()}
            className="rounded-md bg-codezal-accent px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-50"
          >
            <Plus className="inline h-3 w-3" /> Ekle
          </button>
        </div>
        <p className="mt-1 text-[11px] text-codezal-mute">
          Marketplace'ler index/metadata tutar. Plugin'ler upstream repo'lardan SHA-pin'li çekilir.
        </p>
      </section>

      {/* Marketplace listesi */}
      {marketplaces.length > 0 && (
        <section>
          <h3 className="mb-2 text-[12px] font-medium text-codezal-text">
            Marketplace'ler ({marketplaces.length})
          </h3>
          <div className="space-y-1.5">
            {marketplaces.map((mp) => (
              <div
                key={mp.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                  selectedMpId === mp.id
                    ? "border-codezal-accent bg-codezal-panel-2"
                    : "border-codezal bg-codezal-panel-2/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedMpId(mp.id)}
                  className="flex-1 text-left text-[12px] text-codezal-text"
                >
                  {mp.name}
                  <span className="ml-2 text-[11px] text-codezal-mute">{mp.url}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handlePull(mp)}
                  disabled={busy}
                  title="Güncelle (pull)"
                  className="rounded p-1 text-codezal-mute hover:bg-codezal-panel hover:text-codezal-text"
                >
                  <RefreshCcw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveMp(mp.id)}
                  disabled={busy}
                  title="Kaldır"
                  className="rounded p-1 text-codezal-mute hover:bg-codezal-panel hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Plugin kataloğu */}
      {index && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-medium text-codezal-text">
              {index.name} — {filteredEntries.length} plugin
            </h3>
            <div className="flex gap-1 text-[11px]">
              {(["all", "codezal-curated", "community"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  className={cn(
                    "rounded px-2 py-0.5",
                    filter === c
                      ? "bg-codezal-accent text-black"
                      : "bg-codezal-panel-2 text-codezal-mute",
                  )}
                >
                  {c === "all" ? "Tümü" : c === "codezal-curated" ? "Official" : "Topluluk"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {filteredEntries.map((e) => {
              const isInstalled = installedIds.has(e.id)
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-md border border-codezal bg-codezal-panel-2/40 px-2.5 py-1.5"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-codezal-text">
                      <span>{e.name}</span>
                      {e.verified ? (
                        <span title="Codezal tarafından doğrulandı" className="inline-flex">
                          <Shield className="h-3 w-3 text-codezal-accent" />
                        </span>
                      ) : (
                        <span title="Topluluk — kendi sorumluluğunda" className="inline-flex">
                          <ShieldAlert className="h-3 w-3 text-yellow-500" />
                        </span>
                      )}
                      <span className="text-[10px] text-codezal-mute">{e.channel}</span>
                    </div>
                  </div>
                  {isInstalled ? (
                    <span className="text-[11px] text-codezal-accent">
                      <Check className="inline h-3 w-3" /> Kurulu
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleInstallClick(e)}
                      className="rounded bg-codezal-accent px-2 py-1 text-[11px] font-medium text-black disabled:opacity-50"
                    >
                      Kur
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Kurulu plugin'ler */}
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-codezal-text">
          Kurulu Eklentiler ({installed.length})
        </h3>
        {installed.length === 0 && (
          <p className="text-[11px] text-codezal-mute">
            Henüz eklenti kurulmamış. Marketplace'ten kur veya custom URL ekle.
          </p>
        )}
        <div className="space-y-1.5">
          {installed.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-codezal bg-codezal-panel-2/40 px-2.5 py-1.5"
            >
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-[12px] text-codezal-text">
                  <span>{p.name}</span>
                  <span className="text-[10px] text-codezal-mute">v{p.version}</span>
                  <span className="text-[10px] text-codezal-mute">· {p.channel}</span>
                </div>
                <div className="text-[10px] text-codezal-mute">
                  Yazar: {p.manifest.author.name}
                  {p.manifest.upstream && (
                    <>
                      {" · "}
                      <a
                        href={p.manifest.upstream}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 hover:text-codezal-accent"
                      >
                        upstream <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </>
                  )}
                  {" · "}
                  {p.manifest.license}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleToggle(p)}
                disabled={busy}
                title={p.enabled ? "Devre dışı bırak" : "Etkinleştir"}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-medium",
                  p.enabled
                    ? "bg-codezal-accent/20 text-codezal-accent"
                    : "bg-codezal-panel text-codezal-mute",
                )}
              >
                {p.enabled ? "Açık" : "Kapalı"}
              </button>
              <button
                type="button"
                onClick={() => void handleUninstall(p)}
                disabled={busy}
                title="Kaldır"
                className="rounded p-1 text-codezal-mute hover:bg-codezal-panel hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
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
