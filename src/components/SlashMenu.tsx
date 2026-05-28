// Composer textarea üstünde floating slash picker.
// `/` ile yazınca açılır, filtreler, ↑↓ ⏎ ile seçilir.
import { useEffect, useMemo, useRef } from "react"
import { Bot, FileText, Globe, MessageSquarePlus, RefreshCcw, Search, Settings, Sparkles, Square, Trash2, Zap } from "lucide-react"
import type { SlashCommand } from "@/lib/commands"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = {
  open: boolean
  query: string // "/" sonrası
  commands: SlashCommand[]
  selectedIndex: number
  onSelectIndex: (i: number) => void
  onPick: (cmd: SlashCommand) => void
}

export function SlashMenu({ open, query, commands, selectedIndex, onSelectIndex, onPick }: Props) {
  const t = useT()
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query])
  const listRef = useRef<HTMLDivElement>(null)

  // Seçili öğeyi görünür tut
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, filtered.length])

  if (!open) return null

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-[280px] overflow-hidden rounded-md border border-codezal bg-codezal-panel shadow-xl">
      <div ref={listRef} className="max-h-[260px] overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-codezal-mute">{t("slashMenu.noMatchingCommands")}</div>
        ) : (
          filtered.map((c, i) => {
            const Icon = iconFor(c)
            return (
              <button
                key={c.scope + "/" + c.name}
                type="button"
                data-idx={i}
                onMouseEnter={() => onSelectIndex(i)}
                onClick={() => onPick(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px]",
                  i === selectedIndex
                    ? "bg-codezal-chip text-codezal-text"
                    : "text-codezal-text hover:bg-codezal-panel-2",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
                <span className="font-mono text-[12.5px]">/{c.name}</span>
                <span className="truncate text-[11.5px] text-codezal-mute">
                  {c.description}
                </span>
                <span className="ml-auto rounded bg-codezal-chip px-1.5 py-0.5 text-[10px] text-codezal-dim">
                  {c.scope === "builtin"
                    ? t("slashMenu.builtin")
                    : c.scope === "project"
                      ? t("slashMenu.project")
                      : c.scope === "plugin"
                        ? "plugin"
                        : t("slashMenu.global")}
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="border-t border-codezal px-3 py-1 text-[10.5px] text-codezal-mute">
        {t("slashMenu.footerHelp")}
      </div>
    </div>
  )
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase().trim()
  if (!q) return commands
  return commands.filter(
    (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  )
}

function iconFor(c: SlashCommand) {
  if (c.scope !== "builtin") return Sparkles
  switch (c.action) {
    case "clear":
      return Trash2
    case "branch":
      return RefreshCcw
    case "model":
      return Zap
    case "agent":
      return Bot
    case "skill":
      return Sparkles
    case "workspace":
      return Globe
    case "search":
      return Search
    case "routines":
      return Zap
    case "settings":
      return Settings
    case "stop":
      return Square
    case "help":
      return MessageSquarePlus
    default:
      return FileText
  }
}
