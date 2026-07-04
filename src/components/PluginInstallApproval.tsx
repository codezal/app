import { useEffect, useState } from "react"
import {
  AlertTriangle,
  BadgeCheck,
  ExternalLink,
  Shield,
  ShieldAlert,
  X,
} from "@/lib/icons"
import {
  describePermission,
  highRiskPermissions,
  isHighRisk,
  verifyManifestSignature,
  type MarketplacePluginManifest,
  type Permission,
  type VerifyResult,
} from "@/lib/plugins"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = {
  manifest: MarketplacePluginManifest
  marketplaceName: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}

// translation happens in the component.
type ComboKey = "apiKeyLeak" | "dataExfil" | "rce" | "mcpBackdoor" | "persistence"

function detectPermissionCombos(perms: string[]): ComboKey[] {
  const has = (p: string) => perms.includes(p)
  const out: ComboKey[] = []
  if (has("network.fetch") && has("providers.register")) out.push("apiKeyLeak")
  if (has("network.fetch") && has("filesystem.read")) out.push("dataExfil")
  if (has("shell.exec") && has("network.fetch")) out.push("rce")
  if (has("mcp.register") && has("network.fetch")) out.push("mcpBackdoor")
  if (has("filesystem.write") && has("hooks.register")) out.push("persistence")
  return out
}

// Manifest URL'leri marketplace'ten gelir (untrusted). React href'i sanitize
function safeHttpUrl(u: string | undefined): string | undefined {
  return u && /^https?:\/\//i.test(u) ? u : undefined
}

export function PluginInstallApproval({
  manifest,
  marketplaceName,
  onConfirm,
  onCancel,
  busy,
  error,
}: Props) {
  const t = useT()
  const highRisks = highRiskPermissions(manifest.permissions)
  const combos = detectPermissionCombos(manifest.permissions)
  const [ack, setAck] = useState(false)
  const isCuratedVerified = manifest.channel === "codezal-curated" && manifest.verified
  const [sigStatus, setSigStatus] = useState<VerifyResult | "checking" | null>(
    isCuratedVerified ? "checking" : null,
  )
  // during-render; effect'te sync setState cascading-render lint'i tetikler).
  const [prevManifest, setPrevManifest] = useState(manifest)
  if (manifest !== prevManifest) {
    setPrevManifest(manifest)
    setSigStatus(isCuratedVerified ? "checking" : null)
  }
  const needsAck = highRisks.length > 0 || combos.length > 0
  const sigBlocks = sigStatus === "invalid"
  const canConfirm = (!needsAck || ack) && !sigBlocks

  // Combo key → translated {title, detail}
  const comboTranslations: Record<ComboKey, { title: string; detail: string }> = {
    apiKeyLeak: { title: t("pluginInstall.comboApiKeyLeak"), detail: t("pluginInstall.comboApiKeyLeakDetail") },
    dataExfil: { title: t("pluginInstall.comboDataExfil"), detail: t("pluginInstall.comboDataExfilDetail") },
    rce: { title: t("pluginInstall.comboRce"), detail: t("pluginInstall.comboRceDetail") },
    mcpBackdoor: { title: t("pluginInstall.comboMcpBackdoor"), detail: t("pluginInstall.comboMcpBackdoorDetail") },
    persistence: { title: t("pluginInstall.comboPersistence"), detail: t("pluginInstall.comboPersistenceDetail") },
  }

  useEffect(() => {
    if (!isCuratedVerified) return
    let alive = true
    void verifyManifestSignature(manifest).then((r) => {
      if (alive) setSigStatus(r)
    })
    return () => {
      alive = false
    }
  }, [manifest, isCuratedVerified])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-codezal px-4 py-3">
          <span className="flex-1 text-base font-semibold text-codezal-text">
            {t("pluginInstall.title")}{" "}
            <span className="font-mono text-sm font-medium">{manifest.name}</span>
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

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          {/* Meta */}
          <div className="rounded-md border border-codezal bg-codezal-panel-2/40 p-3 text-codezal-text">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="font-medium">{manifest.name}</span>
              <span className="text-sm text-codezal-mute">v{manifest.version}</span>
              {manifest.verified ? (
                <span title={t("pluginInstall.verifiedBadge")} className="inline-flex">
                  <Shield className="h-4 w-4 text-codezal-accent" />
                </span>
              ) : (
                <span title={t("pluginInstall.communityBadge")} className="inline-flex">
                  <ShieldAlert className="h-4 w-4 text-yellow-500" />
                </span>
              )}
              <span className="text-sm text-codezal-mute">· {manifest.channel}</span>
              {sigStatus === "valid" && (
                <span
                  title={t("pluginInstall.signedBadge")}
                  className="inline-flex items-center gap-0.5 text-sm text-codezal-accent"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> {t("pluginInstall.signedBadge")}
                </span>
              )}
              {sigStatus === "invalid" && (
                <span
                  title={t("pluginInstall.invalidSigBadge")}
                  className="inline-flex items-center gap-0.5 text-sm text-destructive"
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("pluginInstall.invalidSigBadge")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-codezal-dim">{manifest.description}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-codezal-mute">
              <div>
                <span className="text-codezal-dim">{t("pluginInstall.authorLabel")}</span> {manifest.author.name}
              </div>
              <div>
                <span className="text-codezal-dim">{t("pluginInstall.licenseLabel")}</span> {manifest.license}
              </div>
              <div>
                <span className="text-codezal-dim">{t("pluginInstall.marketplaceLabel")}</span> {marketplaceName}
              </div>
              {safeHttpUrl(manifest.upstream) && (
                <div className="col-span-2">
                  <a
                    href={safeHttpUrl(manifest.upstream)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-codezal-accent"
                  >
                    {t("pluginInstall.upstreamLabel")} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </div>
            {manifest.attribution && (
              <div className="mt-2 rounded border border-codezal-accent/30 bg-codezal-accent/5 p-2 text-sm">
                <div className="font-medium text-codezal-accent">{t("pluginInstall.attributionTitle")}</div>
                <div className="text-codezal-dim">
                  {t("pluginInstall.attributionOriginalAuthor")} {manifest.attribution.originalAuthor}
                </div>
                <div className="text-codezal-dim">
                  {t("pluginInstall.attributionOriginalRepo")}{" "}
                  {safeHttpUrl(manifest.attribution.originalRepo) ? (
                    <a
                      href={safeHttpUrl(manifest.attribution.originalRepo)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-codezal-accent"
                    >
                      {manifest.attribution.originalRepo}
                    </a>
                  ) : (
                    <span className="break-all">{manifest.attribution.originalRepo}</span>
                  )}
                </div>
                {manifest.attribution.modified && (
                  <div className="text-yellow-500">{t("pluginInstall.attributionModified")}</div>
                )}
                {manifest.attribution.notice && (
                  <p className="mt-1 text-codezal-mute">{manifest.attribution.notice}</p>
                )}
              </div>
            )}
          </div>

          {/* Permissions */}
          <div>
            <h4 className="mb-1.5 text-sm font-medium text-codezal-text">
              {t("pluginInstall.permissionsTitle").replace("{count}", String(manifest.permissions.length))}
            </h4>
            {manifest.permissions.length === 0 ? (
              <p className="text-sm text-codezal-mute">{t("pluginInstall.noPermissions")}</p>
            ) : (
              <ul className="space-y-1">
                {manifest.permissions.map((p) => (
                  <li
                    key={p}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1 text-sm",
                      isHighRisk(p as Permission)
                        ? "bg-destructive/10 text-destructive"
                        : "bg-codezal-panel-2/40 text-codezal-text",
                    )}
                  >
                    {isHighRisk(p as Permission) && (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-mono text-sm">{p}</span>
                    <span className="text-codezal-mute">— {describePermission(p as Permission)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {manifest.permissions.includes("network.fetch") && (
            <div>
              <h4 className="mb-1.5 text-sm font-medium text-codezal-text">
                {t("pluginInstall.networkAccessTitle")}
              </h4>
              {!manifest.network?.allowedHosts?.length ? (
                <p className="rounded bg-codezal-panel-2/40 px-2 py-1 text-sm text-codezal-mute">
                  {t("pluginInstall.networkNoHostsDeclared")}
                </p>
              ) : manifest.network.allowedHosts.includes("*") ? (
                <p className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive">
                  {t("pluginInstall.networkWildcardWarning")}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {manifest.network.allowedHosts.map((h) => (
                    <li
                      key={h}
                      className="rounded bg-codezal-panel-2/40 px-2 py-1 font-mono text-sm text-codezal-text"
                    >
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <h4 className="mb-1.5 text-sm font-medium text-codezal-text">{t("pluginInstall.contributesTitle")}</h4>
            <ul className="space-y-0.5 text-sm text-codezal-mute">
              {manifest.contributes.agents?.length ? (
                <li>· {t("pluginInstall.agentCount").replace("{count}", String(manifest.contributes.agents.length))}</li>
              ) : null}
              {manifest.contributes.commands?.length ? (
                <li>· {t("pluginInstall.commandCount").replace("{count}", String(manifest.contributes.commands.length))}</li>
              ) : null}
              {manifest.contributes.skills?.length ? (
                <li>· {t("pluginInstall.skillCount").replace("{count}", String(manifest.contributes.skills.length))}</li>
              ) : null}
              {manifest.contributes.mcps?.length ? (
                <li className="text-yellow-500">
                  · {t("pluginInstall.mcpCount").replace("{count}", String(manifest.contributes.mcps.length))}
                </li>
              ) : null}
              {manifest.contributes.hooks?.length ? (
                <li className="text-yellow-500">
                  · {t("pluginInstall.hookCount").replace("{count}", String(manifest.contributes.hooks.length))}
                </li>
              ) : null}
              {manifest.contributes.providers?.length ? (
                <li>· {t("pluginInstall.providerCount").replace("{count}", String(manifest.contributes.providers.length))}</li>
              ) : null}
            </ul>
          </div>

          {sigStatus === "invalid" && (
            <div className="rounded-md border border-destructive/60 bg-destructive/15 p-2.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> {t("pluginInstall.invalidSigTitle")}
              </div>
              <p className="mt-1 text-sm text-destructive/85">
                {t("pluginInstall.invalidSigBody")}
              </p>
            </div>
          )}

          {/* Install hata kutusu */}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4" /> {t("pluginInstall.installErrorTitle")}
              </div>
              <p className="mt-1 break-words font-mono text-sm">{error}</p>
            </div>
          )}

          {combos.length > 0 && (
            <div className="space-y-2">
              {combos.map((comboKey, i) => {
                const combo = comboTranslations[comboKey]
                return (
                  <div
                    key={i}
                    className="rounded-md border border-destructive/60 bg-destructive/15 p-2.5"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                      <AlertTriangle className="h-4 w-4" /> {combo.title}
                    </div>
                    <p className="mt-1 text-sm text-destructive/85">{combo.detail}</p>
                  </div>
                )
              })}
            </div>
          )}

          {needsAck && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> {t("pluginInstall.highRiskTitle")}
              </div>
              {highRisks.length > 0 && (
                <p className="mt-1 text-sm text-destructive/80">
                  {t("pluginInstall.highRiskBody").replace("{permissions}", highRisks.join(", "))}
                </p>
              )}
              <label className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {t("pluginInstall.ackCheckbox")}
              </label>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            {t("pluginInstall.cancelBtn")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            className="rounded-md bg-codezal-text px-3 py-1.5 text-sm font-medium text-codezal-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("pluginInstall.installBtn")}
          </button>
        </footer>
      </div>
    </div>
  )
}
