import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { Select } from "@/components/Select"
import {
  CUSTOM_IMAGE_PROVIDER_ID,
  DEFAULT_IMAGE_TIMEOUT_MS,
  IMAGE_PRESETS,
  imagePreset,
  isStockImageModel,
} from "@/lib/image-gen"
import type { ImageGenerationConfig } from "@/store/types"
import { Section, Toggle } from "./primitives"

const DEFAULT_CFG: ImageGenerationConfig = {
  enabled: false,
  providerId: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  defaultSize: "",
  timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS,
}

export function ImageGenTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const setToolSecret = useSettingsStore((s) => s.setToolSecret)
  const cfg = { ...DEFAULT_CFG, ...(settings.imageGeneration ?? {}) }

  const selectedId = cfg.providerId || CUSTOM_IMAGE_PROVIDER_ID
  const preset = imagePreset(cfg.providerId)
  const isCustom = !preset
  const storedKey = settings.imageGeneration?.apiKey ?? ""

  function patch(p: Partial<ImageGenerationConfig>) {
    void update({ imageGeneration: { ...cfg, ...p } })
  }

  function onProvider(v: string) {
    const p = imagePreset(v)
    if (p) {
      // Model: keep a user-typed custom value; overwrite blank/stock defaults with
      // the new preset's default (so switching OpenAI→Gemini updates the model).
      patch({
        providerId: p.id,
        baseUrl: p.baseUrl,
        model: isStockImageModel(cfg.model) ? p.defaultModel : cfg.model,
      })
    } else {
      patch({ providerId: CUSTOM_IMAGE_PROVIDER_ID, baseUrl: "" })
    }
  }

  const providerOptions = [
    ...IMAGE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    { value: CUSTOM_IMAGE_PROVIDER_ID, label: t("settings.imageGen.providerCustom") },
  ]
  const modelPlaceholder = preset?.defaultModel ?? t("settings.imageGen.modelPh")

  return (
    <div className="space-y-6">
      <Section title={t("settings.imageGen.title")}>
        <p className="mb-3 text-md leading-relaxed text-codezal-mute">
          {t("settings.imageGen.hint")}
        </p>

        <label className="mb-3 flex items-center justify-between gap-3 text-md">
          <span className="text-codezal-text">{t("settings.imageGen.enable")}</span>
          <Toggle
            checked={cfg.enabled}
            onChange={(enabled) => patch({ enabled })}
            label={t("settings.imageGen.enable")}
          />
        </label>

        {cfg.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.providerLabel")}
              </span>
              <Select value={selectedId} onChange={onProvider} options={providerOptions} />
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.baseUrlLabel")}
              </span>
              <input
                value={cfg.baseUrl ?? ""}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder={t("settings.imageGen.baseUrlPh")}
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.apiKeyLabel")}
              </span>
              {/* Anahtar keychain'de (setToolSecret). Uncontrolled + blur'da yazar.
                  key={storedKey} store dışarıdan değişince remount edip senkronlar. */}
              <input
                key={storedKey}
                type="password"
                defaultValue={storedKey}
                placeholder="sk-..."
                onBlur={(e) => {
                  if (e.target.value !== storedKey) void setToolSecret("imagegen", e.target.value)
                }}
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
              {!isCustom && preset?.reuseProvider && (
                <span className="text-md leading-relaxed text-codezal-mute">
                  {t("settings.imageGen.apiKeyReuseHint", { provider: preset.label })}
                </span>
              )}
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.modelLabel")}
              </span>
              <input
                value={cfg.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder={modelPlaceholder}
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.sizeLabel")}
              </span>
              <input
                value={cfg.defaultSize ?? ""}
                onChange={(e) => patch({ defaultSize: e.target.value })}
                placeholder="1024x1024"
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-md font-medium text-codezal-dim">
                {t("settings.imageGen.timeoutLabel")}
              </span>
              <input
                type="number"
                min={10000}
                max={600000}
                step={10000}
                value={cfg.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS}
                onChange={(e) =>
                  patch({
                    timeoutMs: Math.max(
                      10000,
                      Math.min(600000, Number(e.target.value) || DEFAULT_IMAGE_TIMEOUT_MS),
                    ),
                  })
                }
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 text-md text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>

            <p className="col-span-2 mt-1 rounded-lg border border-codezal bg-codezal-panel-2 px-3 py-2 text-md leading-relaxed text-codezal-mute">
              {t("settings.imageGen.qualityHint")}
            </p>
          </div>
        )}
      </Section>
    </div>
  )
}
