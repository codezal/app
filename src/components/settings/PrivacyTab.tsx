import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { DEFAULT_PRIVACY, DEFAULT_DETECTORS, type PiiType } from "@/lib/privacy"
import { ShieldCheck } from "@/lib/icons"
import { Section, Row, Toggle } from "./primitives"

const DETECTOR_LABELS: Record<Exclude<PiiType, "CUSTOM">, string> = {
  EMAIL: "E-posta",
  PHONE: "Telefon",
  SSN: "SSN",
  CARD: "Kredi kartı",
  IBAN: "IBAN",
  AWS_KEY: "AWS anahtarı",
  GH_TOKEN: "GitHub token",
  PRIVATE_KEY: "Private key",
  JWT: "JWT",
  IP: "IP adresi",
  SECRET: "Secret (anahtar=değer)",
}

const DETECTOR_KEYS = Object.keys(DETECTOR_LABELS) as Exclude<PiiType, "CUSTOM">[]

export function PrivacyTab() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const t = useT()

  const cfg = settings.privacy ?? DEFAULT_PRIVACY
  const detectors = { ...DEFAULT_DETECTORS, ...(cfg.detectors ?? {}) }
  const patch = (p: Partial<typeof cfg>) => void update({ privacy: { ...cfg, ...p } })

  return (
    <div className="space-y-6">
      <Section title={t("settings.privacy.title")} description={t("settings.privacy.desc")}>
        <Row label={t("settings.privacy.enableLabel")} description={t("settings.privacy.enableDesc")}>
          <Toggle
            label={t("settings.privacy.enableLabel")}
            checked={cfg.enabled}
            onChange={(v) => patch({ enabled: v })}
          />
        </Row>
        <Row label={t("settings.privacy.scrubAssistantLabel")} description={t("settings.privacy.scrubAssistantDesc")}>
          <Toggle
            label={t("settings.privacy.scrubAssistantLabel")}
            checked={cfg.scrubAssistant ?? false}
            onChange={(v) => patch({ scrubAssistant: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.privacy.detectorsTitle")}>
        <div className="grid grid-cols-2 gap-x-6">
          {DETECTOR_KEYS.map((key) => (
            <Row key={key} label={DETECTOR_LABELS[key]}>
              <Toggle
                label={DETECTOR_LABELS[key]}
                checked={detectors[key] !== false}
                onChange={(v) => patch({ detectors: { ...detectors, [key]: v } })}
              />
            </Row>
          ))}
        </div>
      </Section>

      <div className="flex items-start gap-2 rounded-lg border border-codezal bg-codezal-panel px-4 py-3 text-base text-codezal-mute">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-codezal-accent" />
        <span>{t("settings.privacy.failClosed")}</span>
      </div>
    </div>
  )
}
