import { useCallback, useEffect, useState } from "react"
import { ScrollText, RefreshCcw, FileText } from "@/lib/icons"
import { listAllSkills, type Skill } from "@/lib/skills"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"

const EMPTY_DISABLED: string[] = []

export function SkillsTab() {
  const t = useT()
  const ws = useSessionsStore((s) => s.active?.workspacePath)
  const openFile = useSessionsStore((s) => s.openFile)
  const disabled = useSettingsStore((s) => s.settings.disabledSkills ?? EMPTY_DISABLED)
  const setSkillEnabled = useSettingsStore((s) => s.setSkillEnabled)
  const [skills, setSkills] = useState<Skill[] | null>(null)

  const reload = useCallback(() => {
    setSkills(null)
    listAllSkills(ws)
      .then(setSkills)
      .catch(() => setSkills([]))
  }, [ws])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
    const onChange = () => reload()
    window.addEventListener("codezal:skills-changed", onChange)
    return () => window.removeEventListener("codezal:skills-changed", onChange)
  }, [reload])

  const disabledSet = new Set(disabled)

  function refresh() {
    reload()
    window.dispatchEvent(new CustomEvent("codezal:skills-changed"))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-md leading-relaxed text-codezal-dim">{t("settings.skills.desc")}</p>
        <button
          type="button"
          onClick={refresh}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <RefreshCcw className="h-4 w-4" />
          {t("settings.skills.refresh")}
        </button>
      </div>

      {!skills ? (
        <div className="px-1 py-3 text-md text-codezal-mute">…</div>
      ) : skills.length === 0 ? (
        <div className="px-1 py-3 text-md text-codezal-mute">{t("settings.skills.empty")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((s) => {
            const enabled = !disabledSet.has(s.name)
            return (
              <div
                key={s.path}
                className="flex items-start gap-3 rounded-lg border border-codezal bg-codezal-panel px-3 py-2.5"
              >
                <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-codezal-accent" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-md font-medium text-codezal-text">{s.name}</span>
                    <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-md text-codezal-mute">
                      {s.scope}
                    </span>
                    {s.origin !== "codezal" && (
                      <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-md text-codezal-mute">
                        {s.pluginId ? `plugin:${s.pluginId}` : s.origin}
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-md leading-relaxed text-codezal-dim">{s.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openFile(s.path)}
                  title={t("settings.skills.open")}
                  className="shrink-0 rounded p-1.5 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
                >
                  <FileText className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => setSkillEnabled(s.name, !enabled)}
                  title={enabled ? t("settings.skills.enabledOn") : t("settings.skills.enabledOff")}
                  className={cn(
                    "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
                    enabled ? "bg-codezal-accent" : "bg-codezal-chip",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 block h-4 w-4 rounded-full bg-white transition-transform",
                      enabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
