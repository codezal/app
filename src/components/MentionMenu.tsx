import { useEffect, useMemo, useRef } from "react"
import { FileText, GitBranch, Sparkles } from "@/lib/icons"
import { FileTypeIcon, FolderTypeIcon } from "@/lib/file-icons"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { filterMentions } from "@/lib/menu-filters"

export type MentionFileItem = {
  kind: "file"
  name: string
  path: string // absolute
  rel: string
  isDir: boolean
}
export type MentionMcpItem = {
  kind: "mcp"
  server: string
  name: string
  uri: string
  description?: string
}
export type MentionBranchItem = {
  kind: "branch"
  name: string
  current: boolean
}
export type MentionSkillItem = {
  kind: "skill"
  name: string
  description?: string
}

export type MentionItem =
  | MentionFileItem
  | MentionMcpItem
  | MentionBranchItem
  | MentionSkillItem

type Props = {
  open: boolean
  query: string
  items: MentionItem[]
  selectedIndex: number
  onSelectIndex: (i: number) => void
  onPick: (item: MentionItem) => void
  // Composer'ın yatay padding'iyle aynı girintiyi uygular; menu composer kartıyla aynı genişlikte olur.
  inCard?: boolean
}

function itemKey(it: MentionItem): string {
  if (it.kind === "file") return `file:${it.path}`
  if (it.kind === "branch") return `branch:${it.name}`
  if (it.kind === "skill") return `skill:${it.name}`
  return `mcp:${it.server}/${it.uri}`
}

export function MentionMenu({ open, query, items, selectedIndex, onSelectIndex, onPick, inCard = false }: Props) {
  const t = useT()
  const filtered = useMemo(() => filterMentions(items, query), [items, query])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, filtered.length])

  if (!open || filtered.length === 0) return null

  return (
    <div
      className={cn(
        "absolute bottom-full mb-1 flex max-h-[340px] flex-col overflow-hidden cz-menu",
        inCard ? "left-3 right-3" : "left-6 right-6",
      )}
    >
      <div ref={listRef} role="listbox" id="composer-mention-listbox" className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((it, i) => {
          const selected = i === selectedIndex
          return (
            <button
              key={itemKey(it)}
              type="button"
              role="option"
              id={`composer-mention-opt-${i}`}
              aria-selected={selected}
              data-idx={i}
              onMouseEnter={() => onSelectIndex(i)}
              onClick={() => onPick(it)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-base",
                selected ? "bg-codezal-chip text-codezal-text" : "text-codezal-text hover:bg-codezal-panel-2",
              )}
            >
              {it.kind === "file" ? (
                <>
                  {it.isDir ? (
                    <FolderTypeIcon name={it.name} open={false} className="text-codezal-accent" />
                  ) : (
                    <FileTypeIcon name={it.name} className="text-codezal-accent" />
                  )}
                  <span className="shrink-0 whitespace-nowrap font-mono text-base">{it.name}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">{it.rel}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                    {it.isDir ? t("mentionMenu.folder") : t("mentionMenu.file")}
                  </span>
                </>
              ) : it.kind === "branch" ? (
                <>
                  <GitBranch className="h-4 w-4 shrink-0 text-codezal-accent" />
                  <span className="shrink-0 whitespace-nowrap font-mono text-base">{it.name}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
                    {it.current ? t("mentionMenu.currentBranch") : ""}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                    branch
                  </span>
                </>
              ) : it.kind === "skill" ? (
                <>
                  <Sparkles className="h-4 w-4 shrink-0 text-codezal-accent" />
                  <span className="shrink-0 whitespace-nowrap font-mono text-base">{it.name}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
                    {it.description ?? ""}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                    skill
                  </span>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 shrink-0 text-codezal-accent" />
                  <span className="shrink-0 whitespace-nowrap font-mono text-base">@{it.name}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
                    {it.description ?? it.uri}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                    MCP
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div className="shrink-0 border-t border-codezal px-3 py-2 text-sm text-codezal-mute">
        {t("slashMenu.footerHelp")}
      </div>
    </div>
  )
}
