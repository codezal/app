// Kaydetme settings.customProviders'a yazar; apiKey keychain'e gider.
import { useEffect, useMemo, useState } from "react"
import { X, Plus, Trash2, Search, Loader2 } from "@/lib/icons"
import {
  listProviderAdapters,
  probeModels,
  LOCAL_PRESETS,
  type CustomProvider,
  type CustomProviderModel,
  type LocalPreset,
} from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import type { CachedCatalog } from "@/lib/providers-catalog"
import { errorMessage } from "@/lib/errors"

type ModelRow = { rid: number; id: string; name: string }
type HeaderRow = { rid: number; key: string; value: string }

let _rowSeq = 0
const nextRowId = (): number => _rowSeq++

const ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function CustomProviderModal({
  existing,
  onClose,
}: {
  existing?: CustomProvider
  onClose: () => void
}): React.ReactElement {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const saveCustomProvider = useSettingsStore((s) => s.saveCustomProvider)
  const isEdit = Boolean(existing)

  const catalog = (settings.providerCatalog as CachedCatalog | undefined)?.data
  const takenIds = useMemo(() => {
    const ids = new Set(listProviderAdapters(catalog).map((p) => p.id))
    if (existing) ids.delete(existing.id)
    return ids
  }, [catalog, existing])

  const [id, setId] = useState(existing?.id ?? "")
  const [name, setName] = useState(existing?.name ?? "")
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? "")
  const [apiKey, setApiKey] = useState(settings.apiKeys?.[existing?.id ?? ""] ?? "")
  const [models, setModels] = useState<ModelRow[]>(() =>
    existing && existing.models.length > 0
      ? existing.models.map((m) => ({ rid: nextRowId(), id: m.id, name: m.name ?? "" }))
      : [{ rid: nextRowId(), id: "", name: "" }],
  )
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    existing?.headers && Object.keys(existing.headers).length > 0
      ? Object.entries(existing.headers).map(([key, value]) => ({ rid: nextRowId(), key, value }))
      : [{ rid: nextRowId(), key: "", value: "" }],
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const idTrim = id.trim()
  const idError = !idTrim
    ? t("settings.customProvider.errorIdRequired")
    : !ID_RE.test(idTrim)
      ? t("settings.customProvider.errorIdFormat")
      : takenIds.has(idTrim)
        ? t("settings.customProvider.errorIdExists")
        : undefined
  const nameError = !name.trim() ? t("settings.customProvider.errorNameRequired") : undefined
  const urlError = !baseURL.trim()
    ? t("settings.customProvider.errorBaseUrlRequired")
    : !/^https?:\/\//.test(baseURL.trim())
      ? t("settings.customProvider.errorBaseUrlFormat")
      : undefined

  const modelIds = models.map((m) => m.id.trim()).filter(Boolean)
  const hasDupModel = new Set(modelIds).size !== modelIds.length
  const modelsError =
    modelIds.length === 0
      ? t("settings.customProvider.errorModelsRequired")
      : hasDupModel
        ? t("settings.customProvider.errorModelDuplicate")
        : undefined

  const headerKeys = headers.map((h) => h.key.trim().toLowerCase()).filter(Boolean)
  const hasDupHeader = new Set(headerKeys).size !== headerKeys.length
  const headerIncomplete = headers.some(
    (h) => (h.key.trim() && !h.value.trim()) || (!h.key.trim() && h.value.trim()),
  )
  const headersError = hasDupHeader
    ? t("settings.customProvider.errorHeaderDuplicate")
    : headerIncomplete
      ? t("settings.customProvider.errorHeaderIncomplete")
      : undefined

  const valid = !idError && !nameError && !urlError && !modelsError && !headersError

  function setModel(i: number, field: keyof ModelRow, value: string): void {
    setModels((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)))
  }
  function setHeader(i: number, field: keyof HeaderRow, value: string): void {
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? { ...h, [field]: value } : h)))
  }

  function liveHeaders(): Record<string, string> | undefined {
    const entries = headers
      .map((h) => [h.key.trim(), h.value.trim()] as const)
      .filter(([k, v]) => k && v)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  async function handleScan(urlArg?: string): Promise<void> {
    const url = (urlArg ?? baseURL).trim()
    if (!url) {
      setScanMsg({ kind: "err", text: t("settings.customProvider.errorBaseUrlRequired") })
      return
    }
    setScanning(true)
    setScanMsg(null)
    try {
      const ids = await probeModels(url, { apiKey: apiKey.trim() || undefined, headers: liveHeaders() })
      if (ids.length === 0) {
        setScanMsg({ kind: "err", text: t("settings.customProvider.scanEmpty") })
        return
      }
      setModels(ids.map((mid) => ({ rid: nextRowId(), id: mid, name: "" })))
      setScanMsg({ kind: "ok", text: t("settings.customProvider.scanFound", { count: ids.length }) })
    } catch (e) {
      setScanMsg({ kind: "err", text: t("settings.customProvider.scanError", { error: errorMessage(e) }) })
    } finally {
      setScanning(false)
    }
  }

  function applyPreset(p: LocalPreset): void {
    if (!id.trim()) setId(p.id)
    if (!name.trim()) setName(p.name)
    setBaseURL(p.baseURL)
    void handleScan(p.baseURL)
  }

  async function handleSave(): Promise<void> {
    setShowErrors(true)
    if (!valid) return
    setSaveError(null)
    try {
      const cleanModels: CustomProviderModel[] = models
        .map((m) => ({ id: m.id.trim(), name: m.name.trim() || undefined }))
        .filter((m) => m.id)
      const cleanHeaders = Object.fromEntries(
        headers
          .map((h) => [h.key.trim(), h.value.trim()] as const)
          .filter(([k, v]) => k && v),
      )
      const cp: CustomProvider = {
        id: idTrim,
        name: name.trim(),
        baseURL: baseURL.trim(),
        models: cleanModels,
        headers: Object.keys(cleanHeaders).length > 0 ? cleanHeaders : undefined,
      }
      await saveCustomProvider(cp, apiKey.trim())
      onClose()
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-codezal bg-codezal-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-codezal px-4 py-3">
          <h3 className="text-md font-semibold text-codezal-text">
            {isEdit
              ? t("settings.customProvider.editTitle")
              : t("settings.customProvider.title")}
          </h3>
          <button onClick={onClose} className="text-codezal-dim hover:text-codezal-text">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <p className="text-md text-codezal-mute">
            {t("settings.customProvider.description")}
          </p>

          <Field label={t("settings.customProvider.idLabel")} error={showErrors ? idError : undefined}>
            <input
              autoFocus={!isEdit}
              readOnly={isEdit}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-llm"
              className={inputCls(isEdit)}
            />
          </Field>

          <Field label={t("settings.customProvider.nameLabel")} error={showErrors ? nameError : undefined}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My LLM"
              className={inputCls()}
            />
          </Field>

          <Field label={t("settings.customProvider.baseUrlLabel")} error={showErrors ? urlError : undefined}>
            <input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={inputCls()}
            />
          </Field>

          <div className="-mt-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-md text-codezal-mute">
                {t("settings.customProvider.presetsLabel")}
              </span>
              {LOCAL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={scanning}
                  className="rounded-md border border-codezal px-2 py-0.5 text-md text-codezal-dim hover:bg-codezal-input hover:text-codezal-text disabled:opacity-40"
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void handleScan()}
                disabled={scanning || !baseURL.trim()}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-codezal px-2 py-0.5 text-md text-codezal-dim hover:bg-codezal-input hover:text-codezal-text disabled:opacity-40"
              >
                {scanning ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Search className="size-3" />
                )}
                {t("settings.customProvider.scanModels")}
              </button>
            </div>
            {scanMsg && (
              <p className={scanMsg.kind === "ok" ? "text-md text-emerald-500" : "text-md text-red-500"}>
                {scanMsg.text}
              </p>
            )}
          </div>

          <Field
            label={t("settings.customProvider.apiKeyLabel")}
            hint={t("settings.customProvider.apiKeyHint")}
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="key"
              className={inputCls()}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <label className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
              {t("settings.customProvider.modelsLabel")}
            </label>
            {models.map((m, i) => (
              <div key={m.rid} className="flex items-center gap-2">
                <input
                  value={m.id}
                  onChange={(e) => setModel(i, "id", e.target.value)}
                  placeholder={t("settings.customProvider.modelIdPlaceholder")}
                  className={inputCls() + " flex-1"}
                />
                <input
                  value={m.name}
                  onChange={(e) => setModel(i, "name", e.target.value)}
                  placeholder={t("settings.customProvider.modelNamePlaceholder")}
                  className={inputCls() + " flex-1"}
                />
                <IconBtn
                  onClick={() => setModels((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={models.length <= 1}
                  label={t("settings.customProvider.removeRow")}
                />
              </div>
            ))}
            {showErrors && modelsError && <p className="text-md text-red-500">{modelsError}</p>}
            <AddRowBtn
              onClick={() => setModels((prev) => [...prev, { rid: nextRowId(), id: "", name: "" }])}
              label={t("settings.customProvider.addModel")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
              {t("settings.customProvider.headersLabel")}
            </label>
            {headers.map((h, i) => (
              <div key={h.rid} className="flex items-center gap-2">
                <input
                  value={h.key}
                  onChange={(e) => setHeader(i, "key", e.target.value)}
                  placeholder={t("settings.customProvider.headerKeyPlaceholder")}
                  className={inputCls() + " flex-1"}
                />
                <input
                  value={h.value}
                  onChange={(e) => setHeader(i, "value", e.target.value)}
                  placeholder={t("settings.customProvider.headerValuePlaceholder")}
                  className={inputCls() + " flex-1"}
                />
                <IconBtn
                  onClick={() => setHeaders((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={headers.length <= 1}
                  label={t("settings.customProvider.removeRow")}
                />
              </div>
            ))}
            {showErrors && headersError && <p className="text-md text-red-500">{headersError}</p>}
            <AddRowBtn
              onClick={() => setHeaders((prev) => [...prev, { rid: nextRowId(), key: "", value: "" }])}
              label={t("settings.customProvider.addHeader")}
            />
          </div>

          {saveError && <p className="text-md text-red-500">{saveError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-text hover:bg-codezal-input"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            className="rounded-md bg-codezal-accent px-3 py-1.5 text-md font-medium text-white hover:bg-codezal-accent/90"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  )
}

function inputCls(readOnly = false): string {
  return (
    "rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-md text-codezal-text outline-none focus:border-codezal-accent" +
    (readOnly ? " opacity-60" : "")
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
        {label}
      </label>
      <div className="flex flex-col">{children}</div>
      {hint && !error && <p className="text-md text-codezal-mute">{hint}</p>}
      {error && <p className="text-md text-red-500">{error}</p>}
    </div>
  )
}

function IconBtn({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md border border-codezal p-1.5 text-codezal-dim hover:bg-codezal-input hover:text-codezal-text disabled:opacity-40"
    >
      <Trash2 className="size-3.5" />
    </button>
  )
}

function AddRowBtn({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 self-start rounded-md border border-codezal px-2 py-1 text-md text-codezal-dim hover:bg-codezal-input hover:text-codezal-text"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  )
}
