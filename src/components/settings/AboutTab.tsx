import { useEffect, useState } from "react"
import { RefreshCcw } from "@/lib/icons"
import { getVersion } from "@tauri-apps/api/app"
import { openUrl } from "@tauri-apps/plugin-opener"
import { sendFeedback } from "@/lib/report"
import { checkForUpdate } from "@/lib/updater"
import { useUpdateStore } from "@/store/update"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { Section } from "./primitives"

export function AboutTab() {
  const t = useT()
  const [version, setVersion] = useState("")
  const [checking, setChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<"idle" | "uptodate" | "available">("idle")
  // Geri bildirim formu durumu (inline; modal portal yerine — daha basit).
  const [fbText, setFbText] = useState("")
  const [fbSending, setFbSending] = useState(false)
  const [fbSent, setFbSent] = useState(false)
  const [fbError, setFbError] = useState(false)

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])

  const onCheckUpdates = async () => {
    setChecking(true)
    setUpdateStatus("idle")
    try {
      const update = await checkForUpdate()
      if (!update) {
        setUpdateStatus("uptodate")
        return
      }
      setUpdateStatus("available")
      useUpdateStore.getState().present(update)
    } catch {
      setUpdateStatus("uptodate")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-6 text-base text-codezal-dim">
      <div className="flex items-center gap-3">
        <img src="/codezal-icon-squircle-1024.png" alt="Codezal" className="h-10 w-10 rounded-md" />
        <div>
          <div className="text-md font-semibold text-codezal-text">Codezal</div>
          <div className="text-base text-codezal-mute">{t("settings.drawer.aboutSubtitle")}</div>
        </div>
      </div>

      <Section title={t("settings.about.version")}>
        <div className="flex items-center gap-2.5">
          <code className="rounded bg-codezal-panel-2 px-1.5 py-0.5 text-base text-codezal-accent">
            {version || "—"}
          </code>
          <button
            type="button"
            disabled={checking}
            onClick={() => void onCheckUpdates()}
            className="flex h-7 items-center gap-1.5 rounded-md border border-codezal px-2.5 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            {t("settings.about.checkUpdates")}
          </button>
          {updateStatus === "uptodate" && (
            <span className="text-base text-codezal-mute">{t("settings.about.upToDate")}</span>
          )}
          {updateStatus === "available" && (
            <span className="text-base text-codezal-accent">{t("settings.about.updateAvailable")}</span>
          )}
        </div>
      </Section>

      <Section title={t("settings.feedback.title")}>
        <p className="mb-2 text-base">{t("settings.feedback.desc")}</p>
        <textarea
          value={fbText}
          onChange={(e) => {
            setFbText(e.target.value)
            if (fbSent) setFbSent(false)
            if (fbError) setFbError(false)
          }}
          placeholder={t("settings.feedback.placeholder")}
          rows={3}
          className="w-full resize-none rounded-md border border-codezal bg-codezal-panel-2 px-2 py-1.5 text-base text-codezal-text outline-none focus:border-codezal-strong"
        />
        <div className="mt-2 flex items-center gap-2.5">
          <button
            type="button"
            disabled={fbSending || !fbText.trim()}
            onClick={async () => {
              setFbSending(true)
              setFbError(false)
              try {
                const ok = await sendFeedback(fbText)
                if (ok) {
                  setFbText("")
                  setFbSent(true)
                } else {
                  setFbError(true)
                }
              } finally {
                setFbSending(false)
              }
            }}
            className="flex h-7 items-center gap-1.5 rounded-md border border-codezal px-2.5 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
          >
            {t("settings.feedback.send")}
          </button>
          {fbSent && <span className="text-base text-codezal-mute">{t("settings.feedback.sent")}</span>}
          {fbError && <span className="text-base text-codezal-danger">{t("settings.feedback.failed")}</span>}
          <span className="ml-auto text-base text-codezal-mute">v{version}</span>
        </div>
      </Section>

      <Section title={t("settings.drawer.aboutDeveloper")}>
        <div className="space-y-0.5 text-base">
          <div>Erhan Erbaş</div>
          <button type="button" onClick={() => void openUrl("mailto:erhan@erhanerbas.com")} className="text-codezal-mute hover:text-codezal-accent hover:underline">erhan@erhanerbas.com</button>
        </div>
      </Section>

      <Section title={t("settings.drawer.aboutShortcuts")}>
        <ul className="space-y-0.5 font-mono text-base">
          <li>{t("settings.drawer.shortcutNew")}</li>
          <li>{t("settings.drawer.shortcutPalette")}</li>
          <li>{t("settings.drawer.shortcutSettings")}</li>
          <li>{t("settings.drawer.shortcutSearch")}</li>
          <li>{t("settings.drawer.shortcutPanel")}</li>
          <li>{t("settings.drawer.shortcutSend")}</li>
          <li>{t("settings.drawer.shortcutInlineEdit")}</li>
          <li>{t("settings.drawer.shortcutEsc")}</li>
        </ul>
      </Section>

      <Section title={t("settings.drawer.aboutData")}>
        <p className="text-base">
          {t("settings.drawer.aboutDataText")}
        </p>
      </Section>
    </div>
  )
}

