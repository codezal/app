// Top tab strip for the active session.
// The first tab is pinned chat, followed by open files in that session.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GitBranch,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftOpen,
  PanelRight,
  Search,
  Settings,
  Terminal as TerminalIcon,
  X,
} from "@/lib/icons"
import { CodezalBrandGlyph } from "./icons"
import { useSessionsStore } from "@/store/sessions"
import { useDirtyFiles, isDirty } from "@/lib/editor-dirty"
import { ConfirmDialog } from "./ConfirmDialog"
import { basename } from "@/lib/workspace"
import { parseDiffUri } from "@/lib/diff-uri"
import { isTurnDiffUri } from "@/lib/turn-diff-uri"
import { parseOutputUri } from "@/lib/output-doc"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { WindowControls } from "./WindowControls"
import { isMacOS } from "@/lib/platform"
import { MODE_ICON, modeLabel, type PanelMode } from "@/lib/panel-modes"
import { FileTypeIcon } from "@/lib/file-icons"

// PanelMode, modeLabel, and MODE_ICON live in src/lib/panel-modes.tsx to avoid
// Fast Refresh warnings from non-component exports. Keep this type re-export for
// backward compatibility.
export type { PanelMode } from "@/lib/panel-modes"

const editorTabBase =
  "group relative flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-base leading-none transition-colors"
const editorTabActive =
  "border-codezal-hair bg-codezal-panel text-codezal-text shadow-sm"
const editorTabInactive =
  "text-codezal-dim hover:bg-[rgb(var(--codezal-line-rgb)_/_0.04)] hover:text-[hsl(var(--codezal-text))]"
const tabRailButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-codezal-dim transition-colors hover:bg-[rgb(var(--codezal-line-rgb)_/_0.04)] hover:text-[hsl(var(--codezal-text))] disabled:opacity-30 disabled:hover:bg-transparent"

type Props = {
  panelMode: PanelMode | null
  onSetPanelMode: (m: PanelMode | null) => void
  // Shows "Todo" in the top panel menu only while active todos exist.
  todoAvailable?: boolean
  // Shows "SDD" in the top panel menu only while the active session is linked to a draft.
  sddAvailable?: boolean
  // True when the sidebar is collapsed. In that state TabBar takes over the
  // top-left titlebar region (reserves space for traffic lights + expand button).
  sidebarHidden?: boolean
  scrolled?: boolean
  onExpandSidebar?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onNewSession?: () => void
  onOpenFork?: () => void
  onNewProject?: () => void
  // Split view state and toggle.
  splitActive?: boolean
  onToggleSplit?: () => void
  // Side chat (/btw) panel state and toggle.
  sideChatActive?: boolean
  onToggleSideChat?: () => void
  // Header back/forward navigation for opened files/views.
  canNavBack?: boolean
  canNavForward?: boolean
  onNavBack?: () => void
  onNavForward?: () => void
}

export function TabBar({
  panelMode,
  onSetPanelMode,
  todoAvailable,
  sddAvailable,
  sidebarHidden,
  scrolled,
  onExpandSidebar,
  onOpenSearch,
  onOpenSettings,
  onNewSession,
  splitActive,
  onToggleSplit,
  sideChatActive,
  onToggleSideChat,
  canNavBack,
  canNavForward,
  onNavBack,
  onNavForward,
}: Props) {
  const t = useT()
  const tlIcon = "text-codezal-mute"
  const active = useSessionsStore((s) => s.active)
  const setActiveFile = useSessionsStore((s) => s.setActiveFile)
  const closeFile = useSessionsStore((s) => s.closeFile)
  const pinPreviewFile = useSessionsStore((s) => s.pinPreviewFile)
  const reorderOpenFiles = useSessionsStore((s) => s.reorderOpenFiles)
  const dragPathRef = useRef<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const dirtyMap = useDirtyFiles((s) => s.dirty)
  const [pendingClose, setPendingClose] = useState<string | null>(null)
  const requestClose = (p: string) => {
    if (isDirty(p)) setPendingClose(p)
    else closeFile(p)
  }

  const openFiles = active?.openFiles ?? []
  const activeFile = active?.activeFile ?? null
  const previewFile = active?.previewFile ?? null
  const isChat = !activeFile
  const editorSplit = openFiles.length > 0

  const stripRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const recompute = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useLayoutEffect(() => {
    recompute()
  }, [recompute, openFiles.length, activeFile, active?.title])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener("resize", recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", recompute)
    }
  }, [recompute])

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[data-tab-active="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [activeFile, openFiles.length])

  const slide = (dir: -1 | 1) => {
    stripRef.current?.scrollBy({ left: dir * 180, behavior: "smooth" })
  }

  const onStripContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (openFiles.length > 0) setMenu({ x: e.clientX, y: e.clientY })
  }

  const tabItems: TabSwitchItem[] = active
    ? [
        ...(editorSplit ? [] : [{ path: null, label: active.title, active: isChat }]),
        ...openFiles.map((p) => {
          const d = parseDiffUri(p)
          const o = d ? null : parseOutputUri(p)
          const td = !d && !o && isTurnDiffUri(p)
          return {
            path: p,
            label: td ? t("messageList.turnDiffTab") : d ? basename(d.path) : o ? o.title : basename(p),
            title: td ? t("messageList.turnDiffTab") : d ? `diff: ${d.path}` : o ? o.title : p,
            active: activeFile === p,
          }
        }),
      ]
    : []

  return (
    <header
      aria-label={t("a11y.toolbarLandmark")}
      className={cn(
        // Keep the header above content fades and panel dropdowns.
        "relative z-30 flex h-[44px] items-center gap-2 border-b border-transparent bg-codezal-bg px-2",
        // Sidebar collapsed: traffic lights overlay this row at x=20 (Tauri config). The
        // light-side cluster (expand · settings · search · [new-chat] · back · forward,
        // gap-1.5) sits after the lights. Editor mode hides new-chat → 5 buttons (reserve
        // 230px); manual collapse shows it → 6 buttons (reserve 258px). Windows/Linux have
        // no lights, so only the cluster width is reserved (154 / 182px).
        sidebarHidden
          ? isMacOS()
            ? (editorSplit ? "pl-[230px]" : "pl-[258px]")
            : (editorSplit ? "pl-[154px]" : "pl-[182px]")
          : "pl-3",
        scrolled && "border-codezal-panel",
      )}
    >
      {/* Draggable background area that starts after the buttons when sidebar is hidden to prevent click blocking */}
      <div
        data-tauri-drag-region
        className={cn(
          "absolute inset-y-0 right-0 z-0",
          sidebarHidden
            ? isMacOS()
              ? (editorSplit ? "left-[222px]" : "left-[250px]")
              : (editorSplit ? "left-[146px]" : "left-[174px]")
            : "left-0"
        )}
      />
      {sidebarHidden && onExpandSidebar && (
        <div
          className={cn(
            "absolute top-[11px] z-20 flex items-center gap-1.5",
            isMacOS() ? "left-[88px]" : "left-[12px]",
          )}
        >
          <button
            type="button"
            onClick={onExpandSidebar}
            title={t("tabBar.showSidebar")}
            className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text", tlIcon)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title={t("sidebar.settings")}
              className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text", tlIcon)}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              title={t("common.search")}
              className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text", tlIcon)}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          {!editorSplit && onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              title={t("sidebar.newChat")}
              className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text", tlIcon)}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          )}
          {onNavBack && (
            <button
              type="button"
              onClick={onNavBack}
              disabled={!canNavBack}
              title={t("tabBar.navBack")}
              className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-codezal-dim", tlIcon)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {onNavForward && (
            <button
              type="button"
              onClick={onNavForward}
              disabled={!canNavForward}
              title={t("tabBar.navForward")}
              className={cn("flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-codezal-panel-2 hover:text-codezal-text disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-codezal-dim", tlIcon)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <div className="relative z-10 flex h-full min-w-0 flex-1 items-center gap-1">
        {/* Chat tab stays pinned outside the scrollable file strip.
            Hidden in editor mode — chat lives in the left panel there. */}
        {active && !editorSplit && (
          <button
            type="button"
            onClick={() => setActiveFile(null)}
            aria-current={isChat ? "page" : undefined}
            data-tab-active={isChat ? "true" : "false"}
            className={cn(
              editorTabBase,
              "min-w-[104px] max-w-[160px]",
              isChat ? editorTabActive : editorTabInactive,
            )}
            title={active.title}
          >
            <CodezalBrandGlyph
              size={16}
              className="text-codezal-accent"
            />
            <span className="font-medium">Sohbet</span>
          </button>
        )}


        {/* Left overflow control, shown only when hidden tabs exist. */}
        {canLeft && (
          <button
            type="button"
            onClick={() => slide(-1)}
            title={t("tabBar.scrollTabsLeft")}
            aria-label={t("tabBar.scrollTabsLeft")}
            className={tabRailButton}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {/* Scrollable file strip. Chat is pinned, so only file tabs move. */}
        <div
          ref={stripRef}
          onScroll={recompute}
          onContextMenu={onStripContextMenu}
          className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* File tabs */}
          {openFiles.map((path) => {
            const isActive = activeFile === path
            const isPreview = previewFile === path
            const dirty = dirtyMap[path] === true
            // Diff tabs use a codezal-diff URI; output tabs use codezal-output.
            const diff = parseDiffUri(path)
            const out = diff ? null : parseOutputUri(path)
            const turn = !diff && !out && isTurnDiffUri(path)
            const label = turn ? t("messageList.turnDiffTab") : diff ? basename(diff.path) : out ? out.title : basename(path)
            const title = turn ? t("messageList.turnDiffTab") : diff ? `diff: ${diff.path}` : out ? out.title : path
            return (
              <div
                key={path}
                data-tab-active={isActive ? "true" : "false"}
                draggable
                onDragStart={(e) => {
                  dragPathRef.current = path
                  e.dataTransfer.effectAllowed = "move"
                }}
                onDragOver={(e) => {
                  if (dragPathRef.current && dragPathRef.current !== path) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    if (dragOverPath !== path) setDragOverPath(path)
                  }
                }}
                onDragLeave={() => {
                  if (dragOverPath === path) setDragOverPath(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragPathRef.current
                  if (from && from !== path) reorderOpenFiles(from, path)
                  dragPathRef.current = null
                  setDragOverPath(null)
                }}
                onDragEnd={() => {
                  dragPathRef.current = null
                  setDragOverPath(null)
                }}
                className={cn(
                  editorTabBase,
                  "max-w-[220px]",
                  isActive ? editorTabActive : editorTabInactive,
                  // Drop target: accent line marks the insertion point.
                  dragOverPath === path && "border-l-2 border-l-codezal-accent",
                )}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    requestClose(path)
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveFile(path)}
                  // VS Code: double-clicking a preview tab pins it.
                  onDoubleClick={() => isPreview && pinPreviewFile()}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5",
                    isPreview && "italic",
                  )}
                  title={title}
                >
                  {diff ? (
                    <GitBranch
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-codezal-accent" : "text-codezal-mute",
                      )}
                    />
                  ) : out ? (
                    <TerminalIcon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-codezal-accent" : "text-codezal-mute",
                      )}
                    />
                  ) : (
                    <FileTypeIcon name={label} />
                  )}
                  {/* Preview italics can overhang the text box; keep a tiny clip margin. */}
                  <span className="truncate [overflow:clip] [overflow-clip-margin:3px]">{label}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    requestClose(path)
                  }}
                  className={cn(
                    "group/close flex h-[18px] w-[18px] items-center justify-center rounded-sm text-codezal-mute transition-colors hover:bg-[hsl(var(--codezal-chip))] hover:text-[hsl(var(--codezal-text))]",
                    dirty
                      ? "opacity-100"
                      : isActive
                      ? "opacity-70 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-70",
                  )}
                  title={dirty ? t("fileViewer.unsavedTitle") : t("tabBar.closeTabHint")}
                >
                  {dirty ? (
                    <>
                      <span
                        className="h-2 w-2 rounded-full bg-codezal-accent group-hover/close:hidden"
                        aria-hidden
                      />
                      <X className="hidden h-3.5 w-3.5 group-hover/close:block" />
                    </>
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )
          })}

          {/* Remaining space is draggable window chrome. */}
          <div className="h-full min-w-[40px] flex-1" data-tauri-drag-region />
        </div>

        {/* Right overflow control, shown only when hidden tabs exist. */}
        {canRight && (
          <button
            type="button"
            onClick={() => slide(1)}
            title={t("tabBar.scrollTabsRight")}
            aria-label={t("tabBar.scrollTabsRight")}
            className={tabRailButton}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {onToggleSplit && (
        <button
          type="button"
          onClick={onToggleSplit}
          title={t("tabBar.splitView")}
          className={cn(
            "relative z-10 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-sm",
            splitActive
              ? "border-codezal-accent text-codezal-accent"
              : "border-transparent text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
          )}
        >
          <Columns2 className="h-4 w-4" />
        </button>
      )}

      {onToggleSideChat && (
        <button
          type="button"
          onClick={onToggleSideChat}
          title={t("sideChat.toggle")}
          className={cn(
            "relative z-10 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-sm",
            sideChatActive
              ? "border-codezal-accent text-codezal-accent"
              : "border-transparent text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
          )}
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      )}

      <PanelMenu mode={panelMode} onSet={onSetPanelMode} todoAvailable={todoAvailable} sddAvailable={sddAvailable} />

      <WindowControls />

      {menu && (
        <TabSwitcherMenu
          x={menu.x}
          y={menu.y}
          items={tabItems}
          onPick={(path) => {
            setActiveFile(path)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      <ConfirmDialog
        open={pendingClose !== null}
        title={t("fileViewer.unsavedTitle")}
        message={t("fileViewer.unsavedMessage")}
        confirmLabel={t("fileViewer.unsavedConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingClose) closeFile(pendingClose)
          setPendingClose(null)
        }}
        onCancel={() => setPendingClose(null)}
      />
    </header>
  )
}

function PanelMenu({
  mode,
  onSet,
  todoAvailable,
  sddAvailable,
}: {
  mode: PanelMode | null
  onSet: (m: PanelMode | null) => void
  todoAvailable?: boolean
  sddAvailable?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDoc)
    return () => window.removeEventListener("mousedown", onDoc)
  }, [open])

  const items: PanelMode[] = ["files", "git", "agents", "terminal", "preview"]
  const withTodo: PanelMode[] = todoAvailable ? [...items, "todo"] : items
  const menuItems: PanelMode[] = sddAvailable ? [...withTodo, "sdd"] : withTodo

  return (
    <div ref={ref} className="relative z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={mode ? t("tabBar.rightPanelTitle", { mode: modeLabel(mode) }) : t("tabBar.rightPanelOpen")}
        className={cn(
          "flex h-7 items-center gap-1 rounded-md border px-1.5 text-sm",
          mode
            ? "border-transparent bg-codezal-accent/12 text-codezal-accent"
            : "border-transparent text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
        )}
      >
        <PanelRight className="h-4 w-4" />
        <ChevronDown className="h-2.5 w-2.5 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[200px] overflow-hidden cz-menu">
          {menuItems.map((m) => {
            const Icon = MODE_ICON[m]
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSet(active ? null : m)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-base",
                  active
                    ? "bg-codezal-chip text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
              >
                <Icon
                  className={cn("h-3.5 w-3.5", active ? "text-codezal-accent" : "text-codezal-mute")}
                />
                <span>{modeLabel(m)}</span>
                {active && <span className="ml-auto text-sm text-codezal-accent">●</span>}
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
              className="flex w-full items-center gap-2 border-t border-codezal px-3 py-1.5 text-left text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-destructive"
            >
              <X className="h-4 w-4" />
              {t("tabBar.closePanel")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type TabSwitchItem = {
  path: string | null // null = Sohbet tab
  label: string
  title?: string
  active: boolean
}

function TabSwitcherMenu({
  x,
  y,
  items,
  onPick,
  onClose,
}: {
  x: number
  y: number
  items: TabSwitchItem[]
  onPick: (path: string | null) => void
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 max-h-[60vh] w-[240px] overflow-y-auto cz-menu py-1"
    >
      <div className="px-3 py-1 text-sm font-medium text-codezal-mute">{t("tabBar.goToTab")}</div>
      {items.map((it) => {
        const diff = it.path ? parseDiffUri(it.path) : null
        const out = it.path && !diff ? parseOutputUri(it.path) : null
        return (
          <button
            key={it.path ?? "__chat__"}
            type="button"
            role="menuitem"
            onClick={() => onPick(it.path)}
            title={it.title ?? it.label}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
              it.active
                ? "bg-codezal-chip text-codezal-text"
                : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
            )}
          >
            {it.path === null ? (
              <CodezalBrandGlyph
                size={14}
                className="text-codezal-accent"
              />
            ) : diff ? (
              <GitBranch
                className={cn("h-3.5 w-3.5 shrink-0", it.active ? "text-codezal-accent" : "text-codezal-mute")}
              />
            ) : out ? (
              <TerminalIcon
                className={cn("h-3.5 w-3.5 shrink-0", it.active ? "text-codezal-accent" : "text-codezal-mute")}
              />
            ) : (
              <FileTypeIcon name={it.label} className="h-3.5 w-3.5" />
            )}
            <span className="truncate">{it.label}</span>
            {it.active && <span className="ml-auto text-sm text-codezal-accent">●</span>}
          </button>
        )
      })}
    </div>
  )
}
