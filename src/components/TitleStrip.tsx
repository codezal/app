// Üst başlık çubuğu — workspace / session adı + status. Provider/model Composer'da.
// Sağda drag region (native traffic lights sol sidebar başında).
import { useSessionsStore } from "@/store/sessions"
import { basename } from "@/lib/workspace"

export function TitleStrip() {
  const active = useSessionsStore((s) => s.active)
  const wsName = basename(active?.workspacePath) || "klasör yok"
  return (
    <header
      data-tauri-drag-region
      className="flex h-[38px] items-center gap-3 border-b border-codezal bg-codezal-title px-4"
    >
      <span className="text-[12px] text-codezal-dim">{wsName}</span>
      <span className="text-[12px] text-codezal-mute">/</span>
      <span className="truncate text-[13px] font-medium text-codezal-text">
        {active?.title ?? "Yeni oturum"}
      </span>

      <div className="flex-1" data-tauri-drag-region />

      <span className="flex items-center gap-1.5 text-[11px] text-codezal-mute">
        <span className="h-[5px] w-[5px] rounded-full bg-codezal-accent ring-accent-glow" />
        Hazır
      </span>
    </header>
  )
}
