// Üst tab şeridi — aktif session'a aittir.
// İlk tab "Sohbet" (her zaman pin), sonrasında bu session içinde açılmış dosyalar.
import { useEffect, useRef, useState } from "react"
import {
  Bot,
  FileText,
  Folder as FolderIcon,
  GitBranch,
  MessageSquare,
  Notebook,
  PanelRight,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { basename } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

export type PanelMode =
  | "files"
  | "git"
  | "agents"
  | "skills"
  | "memory"
  | "rules"
  | "terminal"

function modeLabel(m: PanelMode): string {
  switch (m) {
    case "files": return tStatic("tabBar.modeFiles")
    case "git": return tStatic("tabBar.modeGit")
    case "agents": return tStatic("tabBar.modeAgents")
    case "skills": return tStatic("tabBar.modeSkills")
    case "memory": return tStatic("tabBar.modeMemory")
    case "rules": return tStatic("tabBar.modeRules")
    case "terminal": return tStatic("tabBar.modeTerminal")
  }
}

const MODE_ICON: Record<PanelMode, React.ComponentType<{ className?: string }>> = {
  files: FolderIcon,
  git: GitBranch,
  agents: Bot,
  skills: Sparkles,
  memory: Notebook,
  rules: ShieldCheck,
  terminal: TerminalIcon,
}

type Props = {
  panelMode: PanelMode | null
  onSetPanelMode: (m: PanelMode | null) => void
}

export function TabBar({ panelMode, onSetPanelMode }: Props) {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const setActiveFile = useSessionsStore((s) => s.setActiveFile)
  const closeFile = useSessionsStore((s) => s.closeFile)

  const openFiles = active?.openFiles ?? []
  const activeFile = active?.activeFile ?? null
  const isChat = !activeFile

  return (
    <header
      data-tauri-drag-region
      className="flex h-[42px] items-end border-b border-codezal bg-codezal-sidebar pl-4 pr-3"
    >
      <div className="flex h-full min-w-0 flex-1 items-end overflow-x-auto">
        {/* Sohbet tab — daima sol başta, pinned */}
        {active && (
          <button
            type="button"
            onClick={() => setActiveFile(null)}
            className={cn(
              "group relative flex h-[34px] min-w-[140px] max-w-[220px] shrink-0 items-center gap-1.5 px-3 text-[12px]",
              isChat
                ? "rounded-t-md border border-b-0 border-codezal bg-codezal-bg text-codezal-text"
                : "border-r border-codezal-hair text-codezal-dim hover:bg-codezal-panel-2/70",
            )}
            title={active.title}
          >
            {isChat && (
              <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-md bg-codezal-accent" />
            )}
            <MessageSquare
              className={cn(
                "h-3 w-3 shrink-0",
                isChat ? "text-codezal-accent" : "text-codezal-mute",
              )}
            />
            <span className="truncate">{active.title}</span>
          </button>
        )}

        {/* File tab'lar */}
        {openFiles.map((path) => {
          const isActive = activeFile === path
          return (
            <div
              key={path}
              className={cn(
                "group relative flex h-[34px] min-w-[140px] max-w-[220px] shrink-0 items-center gap-1.5 px-3 text-[12px]",
                isActive
                  ? "rounded-t-md border border-b-0 border-codezal bg-codezal-bg text-codezal-text"
                  : "border-r border-codezal-hair text-codezal-dim hover:bg-codezal-panel-2/70",
              )}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closeFile(path)
                }
              }}
            >
              {isActive && (
                <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-md bg-codezal-accent" />
              )}
              <button
                type="button"
                onClick={() => setActiveFile(path)}
                className="flex min-w-0 flex-1 items-center gap-1.5"
                title={path}
              >
                <FileText
                  className={cn(
                    "h-3 w-3 shrink-0",
                    isActive ? "text-codezal-accent" : "text-codezal-mute",
                  )}
                />
                <span className="truncate">{basename(path)}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(path)
                }}
                className={cn(
                  "rounded p-0.5 hover:bg-destructive/10 hover:text-destructive",
                  isActive ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70",
                )}
                title={t("tabBar.closeTabHint")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}

        {/* Kalan alan = drag region */}
        <div className="h-full flex-1" data-tauri-drag-region />
      </div>

      <PanelMenu mode={panelMode} onSet={onSetPanelMode} />
    </header>
  )
}

function PanelMenu({
  mode,
  onSet,
}: {
  mode: PanelMode | null
  onSet: (m: PanelMode | null) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Dışa tıklayınca kapat
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDoc)
    return () => window.removeEventListener("mousedown", onDoc)
  }, [open])

  const items: PanelMode[] = ["files", "git", "agents", "skills", "memory", "rules", "terminal"]

  return (
    <div ref={ref} className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={mode ? t("tabBar.rightPanelTitle", { mode: modeLabel(mode) }) : t("tabBar.rightPanelOpen")}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px]",
          mode
            ? "border-codezal-accent text-codezal-accent"
            : "border-codezal text-codezal-dim hover:border-codezal-strong",
        )}
      >
        <PanelRight className="h-3.5 w-3.5" />
        {mode && <span>{modeLabel(mode)}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[200px] overflow-hidden rounded-md border border-codezal bg-codezal-panel shadow-xl">
          {items.map((m) => {
            const Icon = MODE_ICON[m]
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onSet(active ? null : m)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px]",
                  active
                    ? "bg-codezal-chip text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
              >
                <Icon
                  className={cn("h-3.5 w-3.5", active ? "text-codezal-accent" : "text-codezal-mute")}
                />
                <span>{modeLabel(m)}</span>
                {active && <span className="ml-auto text-[10.5px] text-codezal-accent">●</span>}
              </button>
            )
          })}
          {mode && (
            <button
              type="button"
              onClick={() => {
                onSet(null)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 border-t border-codezal px-3 py-1.5 text-left text-[12px] text-codezal-dim hover:bg-codezal-panel-2 hover:text-destructive"
            >
              <X className="h-3 w-3" />
              {t("tabBar.closePanel")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
