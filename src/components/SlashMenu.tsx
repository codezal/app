import { useEffect, useMemo, useRef } from "react"
import { Bot, FileText, Globe, MessageSquarePlus, RefreshCcw, Search, Settings, Sparkles, Square, Trash2, Zap } from "@/lib/icons"
import type { SlashCommand } from "@/lib/commands"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { filterCommands } from "@/lib/menu-filters"

type Props = {
  open: boolean
  query: string
  commands: SlashCommand[]
  selectedIndex: number
  onSelectIndex: (i: number) => void
  onPick: (cmd: SlashCommand) => void
  // Composer'ın yatay padding'iyle aynı girintiyi uygular; menu composer kartıyla aynı genişlikte olur.
  inCard?: boolean
}

export function SlashMenu({ open, query, commands, selectedIndex, onSelectIndex, onPick, inCard = false }: Props) {
  const t = useT()
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, filtered.length])

  if (!open) return null

  return (
    <div
      className={cn(
        "absolute bottom-full mb-1 flex max-h-[340px] flex-col overflow-hidden cz-menu",
        inCard ? "left-3 right-3" : "left-6 right-6",
      )}
    >
      <div ref={listRef} role="listbox" id="composer-slash-listbox" className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-sm text-codezal-mute">{t("slashMenu.noMatchingCommands")}</div>
        ) : (
          filtered.map((c, i) => {
            const Icon = iconFor(c)
            return (
              <button
                key={c.scope + "/" + c.name}
                type="button"
                role="option"
                id={`composer-slash-opt-${i}`}
                aria-selected={i === selectedIndex}
                data-idx={i}
                onMouseEnter={() => onSelectIndex(i)}
                onClick={() => onPick(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-base",
                  i === selectedIndex
                    ? "bg-codezal-chip text-codezal-text"
                    : "text-codezal-text hover:bg-codezal-panel-2",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-codezal-accent" />
                <span className="shrink-0 whitespace-nowrap font-mono text-base">/{c.name}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
                  {c.description}
                </span>
                <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                  {c.scope === "builtin"
                    ? t("slashMenu.builtin")
                    : c.scope === "project"
                      ? t("slashMenu.project")
                      : c.scope === "plugin"
                        ? "plugin"
                        : c.scope === "mcp"
                          ? "MCP"
                          : c.scope === "skill"
                            ? "skill"
                            : t("slashMenu.global")}
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="shrink-0 border-t border-codezal px-3 py-2 text-sm text-codezal-mute">
        {t("slashMenu.footerHelp")}
      </div>
    </div>
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
    case "codemap-index":
      return RefreshCcw
    case "help":
      return MessageSquarePlus
    default:
      return FileText
  }
}
