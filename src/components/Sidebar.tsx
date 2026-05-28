// Sol sidebar — traffic lights başlığı, yeni oturum, nav, proje grupları, user footer.
// Codezal Klasik tasarımı.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronUp,
  Folder,
  MessageSquare,
  MoreVertical,
  PanelLeftClose,
  Play,
  Plus,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { basename, pickWorkspaceFolder } from "@/lib/workspace"
import type { SessionMeta } from "@/store/types"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = {
  onOpenSettings: () => void
  onOpenRoutines?: () => void
  // Bir geçmiş session'ın user mesajlarını yeni session'da yeniden çalıştır.
  onReplay?: (id: string) => void
  // Collapse the sidebar — toggle button next to traffic lights triggers this.
  onCollapse?: () => void
}

export function Sidebar({ onOpenSettings, onOpenRoutines, onReplay, onCollapse }: Props) {
  const { index, activeId, create, open, remove } = useSessionsStore()
  const settings = useSettingsStore((s) => s.settings)
  const [query, setQuery] = useState("")
  const t = useT()

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

  async function onNewProject() {
    // Klasör seçici aç → seçilen path yeni session'ın workspace'i olur,
    // sidebar'da o klasör adıyla yeni bir proje grubu olarak görünür.
    const path = await pickWorkspaceFolder()
    if (!path) return
    await create(settings.defaultProvider, settings.defaultModel, path)
  }

  function onOpen(m: SessionMeta) {
    void open(m.id)
  }

  function onRemove(id: string) {
    void remove(id)
  }

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-codezal bg-codezal-sidebar">
      {/* Drag region. Tauri config: trafficLightPosition x=20 y=16, close button h=12 → center y=22.
          Region h=44 → vertical center y=22. Toggle button h=22 top=11 → center y=22. All aligned. */}
      <div
        data-tauri-drag-region
        className="relative h-[44px] w-full"
      >
        {onCollapse && (
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={onCollapse}
            title="Kenar çubuğunu gizle"
            className="absolute left-[80px] top-[11px] z-20 flex h-[22px] w-[22px] items-center justify-center rounded text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Yeni oturum butonu */}
      <div className="px-2.5 pb-2 pt-1">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-codezal bg-codezal-panel px-2.5 py-2 text-[13px] font-medium text-codezal-text hover:border-codezal-strong"
        >
          <Plus className="h-3.5 w-3.5 text-codezal-accent" />
          {t("sidebar.newSession")}
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
            placeholder={t("common.searchPlaceholder")}
            className="w-full rounded-md border border-codezal bg-transparent py-1.5 pl-7 pr-2 text-[13px] text-codezal-text placeholder:text-codezal-mute outline-none focus:border-codezal-strong"
          />
        </div>
      </div>

      {/* Hızlı nav */}
      <nav className="flex flex-col gap-0.5 px-2.5">
        <NavItem
          icon={<Zap className="h-3 w-3" />}
          label={t("sidebar.routines")}
          onClick={onOpenRoutines}
        />
        <NavItem
          icon={<Sliders className="h-3 w-3" />}
          label={t("sidebar.customize")}
          onClick={onOpenSettings}
        />
      </nav>

      {/* Session listesi — workspace bazlı grupla, bağlı olmayanlar "Klasörsüz" altında */}
      <div className="flex-1 overflow-y-auto px-2.5 pt-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-codezal-mute">
            {query ? t("sidebar.noSearchResults") : t("sidebar.noSessions")}
          </div>
        ) : (
          (() => {
            const grouped = groupByWorkspace(filtered)
            const loose = grouped.find(([k]) => k === "")
            const projects = grouped.filter(([k]) => k !== "")
            const renderGroup = ([wsKey, items]: [string, SessionMeta[]]) => (
              <ProjectGroup
                key={wsKey}
                name={wsKey === "" ? t("sidebar.chats") : basename(wsKey)}
                isLoose={wsKey === ""}
                workspacePath={wsKey || undefined}
                onNewInWorkspace={
                  wsKey
                    ? () =>
                        void create(
                          settings.defaultProvider,
                          settings.defaultModel,
                          wsKey,
                        )
                    : undefined
                }
                onDeleteAllInWorkspace={
                  wsKey
                    ? () => {
                        for (const it of items) void remove(it.id)
                      }
                    : undefined
                }
                onOpenInFinder={
                  wsKey ? () => void openPathInFinder(wsKey) : undefined
                }
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
                            title={t("sidebar.replaySession")}
                          >
                            <Play className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(m.id)}
                          className="rounded p-0.5 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          title={t("sidebar.deleteSession")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ProjectGroup>
            )
            return (
              <>
                {loose && renderGroup(loose)}
                {/* "Projeler" başlığı — daima görünür, projeler yoksa bile + buton ile yeni proje açılabilir */}
                <div className="group/projhead mb-1 mt-2 flex items-center gap-1.5 px-2.5 pb-1">
                  <span className="flex-1 text-[12px] text-codezal-mute">
                    Projeler
                  </span>
                  <button
                    type="button"
                    onClick={() => void onNewProject()}
                    title="Yeni proje (klasör seç)"
                    className="flex h-5 w-5 items-center justify-center rounded text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {projects.length === 0 ? (
                  <div className="px-3 pb-2 text-[11.5px] text-codezal-mute">
                    Henüz proje yok. + ile bir klasör seç.
                  </div>
                ) : (
                  projects.map(renderGroup)
                )}
              </>
            )
          })()
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
            {t("sidebar.accountTier")}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          title={t("sidebar.settings")}
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

// Proje başlığı + altındaki session listesi.
// Bound projects (workspacePath !== "") get + (new session in this workspace)
// and ⋯ (context menu) on hover. Loose chats group hides both.
function ProjectGroup({
  name,
  isLoose,
  workspacePath,
  onNewInWorkspace,
  onDeleteAllInWorkspace,
  onOpenInFinder,
  children,
}: {
  name: string
  isLoose?: boolean
  workspacePath?: string
  onNewInWorkspace?: () => void
  onDeleteAllInWorkspace?: () => void
  onOpenInFinder?: () => void
  children: React.ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Outside-click to close menu
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  return (
    <div className="group/proj mb-3">
      <div className="relative mb-1 flex items-center gap-1.5 px-2.5 pb-1">
        {!isLoose && <Folder className="h-2.5 w-2.5 text-codezal-mute" />}
        <span className="flex-1 truncate text-[12.5px] text-codezal-dim">
          {name}
        </span>
        {!isLoose && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/proj:opacity-100">
            {onNewInWorkspace && (
              <button
                type="button"
                onClick={onNewInWorkspace}
                title="Bu projede yeni sohbet"
                className="flex h-5 w-5 items-center justify-center rounded text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Proje seçenekleri"
                className="flex h-5 w-5 items-center justify-center rounded text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-codezal bg-codezal-panel py-1 text-[12px] shadow-lg">
                  {onNewInWorkspace && (
                    <MenuItem
                      onClick={() => {
                        setMenuOpen(false)
                        onNewInWorkspace()
                      }}
                    >
                      Yeni sohbet
                    </MenuItem>
                  )}
                  {onOpenInFinder && workspacePath && (
                    <MenuItem
                      onClick={() => {
                        setMenuOpen(false)
                        onOpenInFinder()
                      }}
                    >
                      Finder'da aç
                    </MenuItem>
                  )}
                  {onDeleteAllInWorkspace && (
                    <MenuItem
                      danger
                      onClick={() => {
                        setMenuOpen(false)
                        if (window.confirm(`"${name}" altındaki tüm sohbetler silinsin mi?`)) {
                          onDeleteAllInWorkspace()
                        }
                      }}
                    >
                      Tüm sohbetleri sil
                    </MenuItem>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full px-3 py-1.5 text-left",
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-codezal-text hover:bg-codezal-panel-2",
      )}
    >
      {children}
    </button>
  )
}

// Yardımcı: marka logosu daha sonra TitleStrip'te kullanılacak
export { Sparkles as TitleSpark }

// Reveal a workspace path in Finder/Explorer/Files via Tauri opener.
async function openPathInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path)
  } catch (e) {
    console.warn("[sidebar] revealItemInDir failed:", e)
  }
}

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
