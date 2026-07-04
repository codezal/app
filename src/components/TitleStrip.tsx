import { useSessionsStore } from "@/store/sessions"
import { basename } from "@/lib/workspace"
import { useT } from "@/lib/i18n/useT"

export function TitleStrip() {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const wsName = basename(active?.workspacePath) || t("titleStrip.noFolder")
  return (
    <header
      data-tauri-drag-region
      className="flex h-[38px] items-center gap-3 border-b border-codezal bg-codezal-title px-4"
    >
      <span className="text-sm text-codezal-dim">{wsName}</span>
      <span className="text-sm text-codezal-mute">/</span>
      <span className="truncate text-base font-medium text-codezal-text">
        {active?.title ?? t("sidebar.newChat")}
      </span>

      <div className="flex-1" data-tauri-drag-region />

      <span className="flex items-center gap-1.5 text-sm text-codezal-mute">
        <span className="h-[5px] w-[5px] rounded-full bg-codezal-accent ring-accent-glow" />
        {t("titleStrip.ready")}
      </span>
    </header>
  )
}
