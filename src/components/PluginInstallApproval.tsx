// Plugin install onay modal'ı — manifest, permission listesi (high-risk kırmızı),
// attribution + upstream, LICENSE bilgisi. Yüksek-risk varsa checkbox zorunlu.
import { useState } from "react"
import { AlertTriangle, ExternalLink, Shield, ShieldAlert, X } from "lucide-react"
import {
  describePermission,
  highRiskPermissions,
  isHighRisk,
  type MarketplacePluginManifest,
  type Permission,
} from "@/lib/plugins"
import { cn } from "@/lib/utils"

type Props = {
  manifest: MarketplacePluginManifest
  marketplaceName: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}

export function PluginInstallApproval({
  manifest,
  marketplaceName,
  onConfirm,
  onCancel,
  busy,
  error,
}: Props) {
  const highRisks = highRiskPermissions(manifest.permissions)
  const [ack, setAck] = useState(false)
  const needsAck = highRisks.length > 0
  const canConfirm = !needsAck || ack

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-codezal px-4 py-3">
          <span className="flex-1 text-[13px] font-semibold text-codezal-text">
            Eklenti Kur:{" "}
            <span className="font-mono text-[12px] font-medium">{manifest.name}</span>
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[12px]">
          {/* Meta */}
          <div className="rounded-md border border-codezal bg-codezal-panel-2/40 p-3 text-codezal-text">
            <div className="flex items-center gap-1.5 text-[12px]">
              <span className="font-medium">{manifest.name}</span>
              <span className="text-[11px] text-codezal-mute">v{manifest.version}</span>
              {manifest.verified ? (
                <span title="Codezal tarafından doğrulandı" className="inline-flex">
                  <Shield className="h-3 w-3 text-codezal-accent" />
                </span>
              ) : (
                <span title="Topluluk plugin — doğrulanmamış" className="inline-flex">
                  <ShieldAlert className="h-3 w-3 text-yellow-500" />
                </span>
              )}
              <span className="text-[10px] text-codezal-mute">· {manifest.channel}</span>
            </div>
            <p className="mt-1 text-[11px] text-codezal-dim">{manifest.description}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-codezal-mute">
              <div>
                <span className="text-codezal-dim">Yazar:</span> {manifest.author.name}
              </div>
              <div>
                <span className="text-codezal-dim">Lisans:</span> {manifest.license}
              </div>
              <div>
                <span className="text-codezal-dim">Marketplace:</span> {marketplaceName}
              </div>
              {manifest.upstream && (
                <div className="col-span-2">
                  <a
                    href={manifest.upstream}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-codezal-accent"
                  >
                    Upstream kaynağa git <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              )}
            </div>
            {manifest.attribution && (
              <div className="mt-2 rounded border border-codezal-accent/30 bg-codezal-accent/5 p-2 text-[11px]">
                <div className="font-medium text-codezal-accent">Atıf</div>
                <div className="text-codezal-dim">
                  Orijinal yazar: {manifest.attribution.originalAuthor}
                </div>
                <div className="text-codezal-dim">
                  Orijinal repo:{" "}
                  <a
                    href={manifest.attribution.originalRepo}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-codezal-accent"
                  >
                    {manifest.attribution.originalRepo}
                  </a>
                </div>
                {manifest.attribution.modified && (
                  <div className="text-yellow-500">⚠ Codezal tarafından düzenlenmiş</div>
                )}
                {manifest.attribution.notice && (
                  <p className="mt-1 text-codezal-mute">{manifest.attribution.notice}</p>
                )}
              </div>
            )}
          </div>

          {/* Permissions */}
          <div>
            <h4 className="mb-1.5 text-[11px] font-medium text-codezal-text">
              İstenen İzinler ({manifest.permissions.length})
            </h4>
            {manifest.permissions.length === 0 ? (
              <p className="text-[11px] text-codezal-mute">Hiç permission istenmiyor.</p>
            ) : (
              <ul className="space-y-1">
                {manifest.permissions.map((p) => (
                  <li
                    key={p}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1 text-[11px]",
                      isHighRisk(p as Permission)
                        ? "bg-destructive/10 text-destructive"
                        : "bg-codezal-panel-2/40 text-codezal-text",
                    )}
                  >
                    {isHighRisk(p as Permission) && (
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                    )}
                    <span className="font-mono text-[10px]">{p}</span>
                    <span className="text-codezal-mute">— {describePermission(p as Permission)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Contributes özet */}
          <div>
            <h4 className="mb-1.5 text-[11px] font-medium text-codezal-text">İçerik</h4>
            <ul className="space-y-0.5 text-[11px] text-codezal-mute">
              {manifest.contributes.agents?.length ? (
                <li>· {manifest.contributes.agents.length} agent</li>
              ) : null}
              {manifest.contributes.commands?.length ? (
                <li>· {manifest.contributes.commands.length} slash komut</li>
              ) : null}
              {manifest.contributes.skills?.length ? (
                <li>· {manifest.contributes.skills.length} skill</li>
              ) : null}
              {manifest.contributes.mcps?.length ? (
                <li className="text-yellow-500">
                  · {manifest.contributes.mcps.length} MCP server (binary spawn riski)
                </li>
              ) : null}
              {manifest.contributes.hooks?.length ? (
                <li className="text-yellow-500">
                  · {manifest.contributes.hooks.length} hook (bash spawn riski)
                </li>
              ) : null}
              {manifest.contributes.providers?.length ? (
                <li>· {manifest.contributes.providers.length} provider (Faz 3)</li>
              ) : null}
            </ul>
          </div>

          {/* Install hata kutusu */}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3 w-3" /> Kurulum Hatası
              </div>
              <p className="mt-1 break-words font-mono text-[10.5px]">{error}</p>
            </div>
          )}

          {/* High-risk uyarı + checkbox */}
          {needsAck && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Yüksek Riskli Eklenti
              </div>
              <p className="mt-1 text-[11px] text-destructive/80">
                Bu plugin {highRisks.join(", ")} izinleri istiyor. Bash komutu çalıştırabilir,
                dosya yazabilir, binary spawn edebilir. Sadece güvendiğin kaynaklardan kur.
              </p>
              <label className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                Riskleri anladım — kurulumu onaylıyorum.
              </label>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            className="rounded-md bg-codezal-accent px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-50"
          >
            Kur
          </button>
        </footer>
      </div>
    </div>
  )
}
