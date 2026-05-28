// Provider connect modal — apiKey input, optional baseURL/options, OAuth button.
// OAuth supported providers (anthropic, github-copilot) show extra UI: an authorize
// button that opens the browser and a callback paste field for auth-code flow,
// or a device-code panel that polls until the user completes the device login.
import { useEffect, useState } from "react"
import { X, ExternalLink } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  getOAuthFlow,
  type OAuthStartResult,
  type ProviderInfo,
} from "@/lib/providers"
import { getCatalogProviderDefaults } from "@/lib/providers/catalog-derived"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import type { CachedCatalog } from "@/lib/providers-catalog"

export function ProviderConnectModal({
  provider,
  onClose,
}: {
  provider: ProviderInfo
  onClose: () => void
}): React.ReactElement {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const setCredential = useSettingsStore((s) => s.setCredential)
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig)

  // Catalog-derived providers prefill baseURL/envVars from models.dev so the
  // user only has to drop in an API key.
  const catalog = (settings.providerCatalog as CachedCatalog | undefined)?.data
  const catalogDefaults = getCatalogProviderDefaults(catalog, provider.id)

  const [apiKey, setApiKeyInput] = useState(settings.apiKeys?.[provider.id] ?? "")
  const [baseURL, setBaseURL] = useState(
    settings.providerConfigs?.[provider.id]?.baseURL ??
      catalogDefaults?.baseURL ??
      "",
  )
  const [optionsJson, setOptionsJson] = useState(
    JSON.stringify(settings.providerConfigs?.[provider.id]?.options ?? {}, null, 2),
  )
  const [oauthState, setOauthState] = useState<OAuthStartResult | null>(null)
  const [oauthCallback, setOauthCallback] = useState("")
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const supportsApiKey = provider.authMethods.includes("apiKey")
  const supportsOAuth = provider.authMethods.includes("oauth") && provider.oauthName

  async function handleSaveApiKey(): Promise<void> {
    setSaveError(null)
    try {
      if (apiKey.trim()) {
        await setApiKey(provider.id, apiKey.trim())
      }
      const opts = parseOptionsJson(optionsJson)
      const baseURLTrim = baseURL.trim() || undefined
      const hasConfig = Boolean(baseURLTrim) || Object.keys(opts).length > 0
      await setProviderConfig(
        provider.id,
        hasConfig ? { baseURL: baseURLTrim, options: opts } : null,
      )
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleOAuthStart(): Promise<void> {
    if (!provider.oauthName) return
    const flow = getOAuthFlow(provider.oauthName)
    if (!flow) {
      setOauthError(`OAuth flow not found: ${provider.oauthName}`)
      return
    }
    setOauthBusy(true)
    setOauthError(null)
    try {
      const started = await flow.start()
      setOauthState(started)
      if (started.kind === "authCodePkce") {
        await openUrl(started.authorizeUrl)
      } else if (started.kind === "deviceCode") {
        await openUrl(started.verificationUri)
        // Polling otomatik başlat
        void pollDeviceCode(flow, started)
      }
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e))
    } finally {
      setOauthBusy(false)
    }
  }

  async function handleOAuthComplete(): Promise<void> {
    if (!provider.oauthName || !oauthState || oauthState.kind !== "authCodePkce") return
    const flow = getOAuthFlow(provider.oauthName)
    if (!flow || !flow.completeAuthCode) return
    setOauthBusy(true)
    setOauthError(null)
    try {
      const cred = await flow.completeAuthCode({
        callbackUrl: oauthCallback,
        state: oauthState.state,
      })
      await setCredential(provider.id, cred)
      onClose()
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e))
    } finally {
      setOauthBusy(false)
    }
  }

  async function pollDeviceCode(
    flow: NonNullable<ReturnType<typeof getOAuthFlow>>,
    started: Extract<OAuthStartResult, { kind: "deviceCode" }>,
  ): Promise<void> {
    if (!flow.pollDeviceCode) return
    setOauthBusy(true)
    try {
      const cred = await flow.pollDeviceCode({
        deviceCode: started.deviceCode,
        interval: started.interval,
        expiresAt: started.expiresAt,
      })
      await setCredential(provider.id, cred)
      onClose()
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e))
    } finally {
      setOauthBusy(false)
    }
  }

  // Backdrop click → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-codezal bg-codezal-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-codezal px-4 py-3">
          <h3 className="text-sm font-semibold text-codezal-text">
            {t("settings.providersPage.connectTo", { name: provider.label })}
          </h3>
          <button onClick={onClose} className="text-codezal-dim hover:text-codezal-text">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          {supportsOAuth && (
            <div className="flex flex-col gap-2 rounded-md border border-codezal bg-codezal-input p-3">
              <div className="text-xs font-medium text-codezal-text">
                {t("settings.providersPage.oauthSignIn")}
              </div>
              {!oauthState ? (
                <button
                  onClick={() => void handleOAuthStart()}
                  disabled={oauthBusy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-codezal-accent/90 disabled:opacity-60"
                >
                  <ExternalLink className="size-3.5" />
                  {oauthBusy
                    ? t("settings.providersPage.oauthOpening")
                    : t("settings.providersPage.oauthStart", { name: provider.label })}
                </button>
              ) : oauthState.kind === "authCodePkce" ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-codezal-dim">
                    {t("settings.providersPage.oauthPasteHint")}
                  </p>
                  <input
                    value={oauthCallback}
                    onChange={(e) => setOauthCallback(e.target.value)}
                    placeholder={t("settings.providersPage.oauthCallbackPlaceholder")}
                    className="rounded-md border border-codezal bg-codezal-panel px-2 py-1.5 text-xs text-codezal-text outline-none focus:border-codezal-accent"
                  />
                  <button
                    onClick={() => void handleOAuthComplete()}
                    disabled={oauthBusy || !oauthCallback.trim()}
                    className="self-start rounded-md bg-codezal-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-codezal-accent/90 disabled:opacity-60"
                  >
                    {oauthBusy
                      ? t("settings.providersPage.oauthCompleting")
                      : t("settings.providersPage.oauthComplete")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-codezal-dim">
                    {t("settings.providersPage.deviceCodeHint")}
                  </p>
                  <div className="rounded-md border border-codezal bg-codezal-panel px-2.5 py-2 font-mono text-lg tracking-widest text-codezal-text">
                    {oauthState.userCode}
                  </div>
                  <p className="text-[11px] text-codezal-mute">
                    {t("settings.providersPage.deviceCodePolling")}
                  </p>
                </div>
              )}
              {oauthError && (
                <p className="text-[11px] text-red-500">{oauthError}</p>
              )}
            </div>
          )}

          {supportsApiKey && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-codezal-dim">
                {t("settings.providersPage.apiKeyLabel")}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={provider.id === "openai" ? "sk-..." : "key"}
                className="rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-codezal-text outline-none focus:border-codezal-accent"
              />
              {provider.envVars.length > 0 && (
                <p className="text-[10px] text-codezal-mute">
                  {t("settings.providersPage.envVarHint", {
                    vars: provider.envVars.join(", "),
                  })}
                </p>
              )}
            </div>
          )}

          {(provider.requiresConfig ||
            provider.id === "openai-compatible" ||
            catalogDefaults) && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-codezal-dim">
                {t("settings.providersPage.baseUrlLabel")}
              </label>
              <input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder={catalogDefaults?.baseURL ?? "https://api.example.com/v1"}
                className="rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-codezal-text outline-none focus:border-codezal-accent"
              />
            </div>
          )}

          {provider.requiresConfig && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-codezal-dim">
                {t("settings.providersPage.optionsJsonLabel")}
              </label>
              <textarea
                value={optionsJson}
                onChange={(e) => setOptionsJson(e.target.value)}
                rows={4}
                className="font-mono rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-[11px] text-codezal-text outline-none focus:border-codezal-accent"
              />
              <p className="text-[10px] text-codezal-mute">
                {t("settings.providersPage.optionsJsonHint")}
              </p>
            </div>
          )}

          {saveError && <p className="text-[11px] text-red-500">{saveError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-codezal px-3 py-1.5 text-xs text-codezal-text hover:bg-codezal-input"
          >
            {t("common.cancel")}
          </button>
          {supportsApiKey && (
            <button
              onClick={() => void handleSaveApiKey()}
              className="rounded-md bg-codezal-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-codezal-accent/90"
            >
              {t("common.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function parseOptionsJson(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (!trimmed || trimmed === "{}") return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}
