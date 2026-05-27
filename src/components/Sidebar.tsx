// Sol sidebar — traffic lights başlığı, yeni oturum, nav, proje grupları, user footer.
// Codezal Klasik tasarımı.
import { useMemo, useState } from "react"
import {
  ChevronUp,
  Folder,
  MessageSquare,
  Play,
  Plus,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { basename } from "@/lib/workspace"
import type { SessionMeta } from "@/store/types"
import { cn } from "@/lib/utils"

type Props = {
  onOpenSettings: () => void
  onOpenRoutines?: () => void
  // Bir geçmiş session'ın user mesajlarını yeni session'da yeniden çalıştır.
  onReplay?: (id: string) => void
}

export function Sidebar({ onOpenSettings, onOpenRoutines, onReplay }: Props) {
  const { index, activeId, create, open, remove } = useSessionsStore()
  const settings = useSettingsStore((s) => s.settings)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    return query.trim()
      ? index.filter((m) =>
          m.title.toLowerCase().includes(query.toLowerCase()),
        )
      : index
  }, [index, query])

  async function onNew() {
    // Yeni oturum klasörsüz başlar; kullanıcı composer'dan seçer.
    await create(settings.defaultProvider, settings.defaultModel, undefined)
  }

  function onOpen(m: SessionMeta) {
    void open(m.id)
  }

  function onRemove(id: string) {
    void remove(id)
  }

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-codezal bg-codezal-sidebar">
      {/* Native traffic lights için drag region. Trafficlight position: x=14 y=14 (tauri.conf) */}
      <div
        data-tauri-drag-region
        className="h-[38px] w-full"
      />

      {/* Yeni oturum butonu */}
      <div className="px-2.5 pb-2 pt-1">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-codezal bg-codezal-panel px-2.5 py-2 text-[13px] font-medium text-codezal-text hover:border-codezal-strong"
        >
          <Plus className="h-3.5 w-3.5 text-codezal-accent" />
          Yeni oturum
          <span className="ml-auto rounded border border-codezal px-1.5 py-0.5 text-[11px] text-codezal-mute">
            ⌘N
          </span>
        </button>
      </div>

      {/* Arama */}
      <div className="px-2.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-codezal-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara"
            className="w-full rounded-md border border-codezal bg-transparent py-1.5 pl-7 pr-2 text-[13px] text-codezal-text placeholder:text-codezal-mute outline-none focus:border-codezal-strong"
          />
        </div>
      </div>

      {/* Hızlı nav */}
      <nav className="flex flex-col gap-0.5 px-2.5">
        <NavItem
          icon={<Zap className="h-3 w-3" />}
          label="Rutinler"
          onClick={onOpenRoutines}
        />
        <NavItem
          icon={<Sliders className="h-3 w-3" />}
          label="Özelleştir"
          onClick={onOpenSettings}
        />
      </nav>

      {/* Session listesi — workspace bazlı grupla, bağlı olmayanlar "Klasörsüz" altında */}
      <div className="flex-1 overflow-y-auto px-2.5 pt-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-codezal-mute">
            {query ? "Sonuç yok" : "Henüz oturum yok"}
          </div>
        ) : (
          groupByWorkspace(filtered).map(([wsKey, items]) => (
            <ProjectGroup
              key={wsKey}
              name={wsKey === "" ? "Sohbetler" : basename(wsKey)}
              isLoose={wsKey === ""}
            >
              <ul className="flex flex-col gap-0.5">
                {items.map((m) => (
                  <li key={m.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]",
                        activeId === m.id
                          ? "bg-codezal-accent-dim text-codezal-text"
                          : "text-codezal-dim hover:bg-codezal-panel-2",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          activeId === m.id
                            ? "bg-codezal-accent ring-accent-glow"
                            : "bg-codezal-mute/60",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => onOpen(m)}
                        className="flex flex-1 items-center gap-2 truncate text-left"
                      >
                        <MessageSquare className="hidden h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate">{m.title}</span>
                      </button>
                      {onReplay && (
                        <button
                          type="button"
                          onClick={() => onReplay(m.id)}
                          className="rounded p-0.5 opacity-0 hover:bg-codezal-panel-2 hover:text-codezal-accent group-hover:opacity-100"
                          title="Replay — yeni session'da user mesajlarını yeniden çalıştır"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemove(m.id)}
                        className="rounded p-0.5 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        title="Sil"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </ProjectGroup>
          ))
        )}
      </div>

      {/* User footer */}
      <div className="flex items-center gap-2.5 border-t border-codezal px-3 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-codezal-accent to-orange-500 text-[11px] font-semibold text-zinc-900">
          EE
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-codezal-text">
            Erhan Erbaş
          </div>
          <div className="text-[11px] text-codezal-mute">
            Max · local
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          title="Ayarlar"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
        <ChevronUp className="h-2.5 w-2.5 text-codezal-mute" />
      </div>
    </aside>
  )
}

// Hızlı nav satırı
function NavItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
    >
      <span className="text-codezal-mute">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// Proje başlığı + altındaki session listesi
function ProjectGroup({
  name,
  isLoose,
  children,
}: {
  name: string
  isLoose?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5 px-2.5 pb-1">
        {!isLoose && <Folder className="h-2.5 w-2.5 text-codezal-mute" />}
        <span className="text-[11px] font-medium uppercase tracking-wide text-codezal-mute">
          {name}
        </span>
      </div>
      {children}
    </div>
  )
}

// Yardımcı: marka logosu daha sonra TitleStrip'te kullanılacak
export { Sparkles as TitleSpark }

// Session metalarını workspacePath bazlı grupla; "" key = klasörsüz
// Sıralama: klasörsüz en altta, diğerleri içindeki en yeni session'a göre
function groupByWorkspace(items: SessionMeta[]): Array<[string, SessionMeta[]]> {
  const map = new Map<string, SessionMeta[]>()
  for (const it of items) {
    const k = it.workspacePath ?? ""
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(it)
  }
  const entries = Array.from(map.entries())
  entries.sort(([ak, av], [bk, bv]) => {
    // Klasörsüz (Sohbetler) en üstte
    if (ak === "" && bk !== "") return -1
    if (bk === "" && ak !== "") return 1
    const am = Math.max(...av.map((x) => x.updatedAt))
    const bm = Math.max(...bv.map((x) => x.updatedAt))
    return bm - am
  })
  return entries
}
