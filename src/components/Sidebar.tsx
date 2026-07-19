import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Archive,
  AtSign,
  Check,
  ChevronRight,
  Circle,
  ClockClockwise,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MessageSquare,
  MoreVertical,
  Palette,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "@/lib/icons"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { useSessionsStore } from "@/store/sessions"
import { emitSessionMessage } from "@/lib/session-message-bus"
import { normHandle, handleTaken } from "@/lib/session-inbox"
import { toast } from "@/store/toast"
import { useSettingsStore } from "@/store/settings"
import { basename, pickWorkspaceFolder } from "@/lib/workspace"
import { startInternalDrag, wasDragging } from "@/lib/internal-drag"
import type { SessionMeta } from "@/store/types"
import { resolveSessionDefaults } from "@/lib/session-defaults"
import { cn } from "@/lib/utils"
import { isMacOS, fmtKbd } from "@/lib/platform"
import { useT, useLocale } from "@/lib/i18n/useT"
import { formatRowTime } from "@/lib/format-time"
import { useApprovalsStore } from "@/store/approvals"
import { ConfirmDialog } from "./ConfirmDialog"
import { NewWorktreeDialog } from "./NewWorktreeDialog"

type Props = {
  onOpenSettings: () => void
  onOpenSession?: () => void
  onOpenRoutines?: () => void
  // Collapse the sidebar — toggle button next to traffic lights triggers this.
  onCollapse?: () => void
  onOpenSearch?: () => void
  onNewProject: () => void
}

const SIDEBAR_MIN_W = 232
const SIDEBAR_MAX_W = 480
const SIDEBAR_DEFAULT_W = 256
const SIDEBAR_W_KEY = "codezal.sidebarWidth"
// Persisted set of collapsed project keys (workspace path; "" = loose chats).
const COLLAPSE_KEY = "codezal.collapsedProjects"

function SectionLabel({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 pt-4">
      <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.12em] text-codezal-dim">
        {children}
      </span>
      <div className="h-px flex-1 bg-codezal-hair" aria-hidden />
      {actions}
    </div>
  )
}


export function Sidebar({ onOpenSettings, onOpenSession, onOpenSearch, onNewProject, onOpenRoutines, onCollapse }: Props) {
  const {
    index,
    projects: knownProjects,
    projectMeta,
    activeId,
    streamingIds,
    createDraft,
    lastSessionContext,
    open,
    remove,
    patchSessionMeta,
    setHandleFor,
    forkSession,
    removeProject,
    setProjectsOrder,
    setProjectMeta,
    relinkProject,
  } = useSessionsStore()
  const settings = useSettingsStore((s) => s.settings)
  const t = useT()
  const approvalQueue = useApprovalsStore((s) => s.queue)
  const waitingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of approvalQueue) if (r.sessionId) ids.add(r.sessionId)
    return ids
  }, [approvalQueue])

  const [archivedOpen, setArchivedOpen] = useState(false)
  const [worktreeRepo, setWorktreeRepo] = useState<string | null>(null)

  // Resizable width — drag right edge to expand. Persists to localStorage.
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_W_KEY)
      const n = saved ? parseInt(saved, 10) : SIDEBAR_DEFAULT_W
      return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, isNaN(n) ? SIDEBAR_DEFAULT_W : n))
    } catch {
      return SIDEBAR_DEFAULT_W
    }
  })
  const draggingRef = useRef(false)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return
      const w = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, e.clientX))
      setWidth(w)
    }
    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(widthRef.current))
      } catch {
        // localStorage unavailable; ignore
      }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  function resizeBy(delta: number) {
    setWidth((current) => {
      const next = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, current + delta))
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(next))
      } catch {
        // localStorage unavailable; ignore
      }
      return next
    })
  }

  const filtered = index.filter((m) => !m.routineId)

  // Collapsed project groups — persisted so the show/hide state survives reloads.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY)
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set<string>()
    }
  })
  function toggleCollapse(key: string) {
    // Ignore the click that immediately follows a drag (set in the drag mouseup).
    if (suppressClickRef.current) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        // localStorage unavailable; ignore
      }
      return next
    })
  }

  // Project drag & drop reordering (pointer-based — reliable in the Tauri
  // webview, unlike native HTML5 DnD). Drag a project header over another to
  // drop it there; the full displayed order is persisted.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  // Cursor'u takip eden floating preview konumu (drag aktifken).
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const pendingRef = useRef<{ key: string; x: number; y: number } | null>(null)
  const projDraggingRef = useRef(false)
  const suppressClickRef = useRef(false)

  function startProjectDrag(key: string, e: React.MouseEvent) {
    pendingRef.current = { key, x: e.clientX, y: e.clientY }
  }

  useEffect(() => {
    function projKeyAt(x: number, y: number): string | null {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      return el?.closest("[data-proj-key]")?.getAttribute("data-proj-key") || null
    }
    function onMove(e: MouseEvent) {
      const p = pendingRef.current
      if (!p) return
      if (!projDraggingRef.current) {
        // Activate drag only after a small move — otherwise it's a click (toggle).
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
        projDraggingRef.current = true
        setDragKey(p.key)
        document.body.style.cursor = "grabbing"
        document.body.style.userSelect = "none"
      }
      setDragPos({ x: e.clientX, y: e.clientY })
      const over = projKeyAt(e.clientX, e.clientY)
      setOverKey(over && over !== p.key ? over : null)
    }
    function onUp(e: MouseEvent) {
      const p = pendingRef.current
      pendingRef.current = null
      if (p && projDraggingRef.current) {
        const over = projKeyAt(e.clientX, e.clientY)
        if (over && over !== p.key) {
          // Rebuild the displayed project order from the store (same logic as
          // render): registry first, then session-derived paths not yet in it.
          const st = useSessionsStore.getState()
          const known = st.projects
          const fromSessions = Array.from(
            new Set(
              st.index
                .map((m) => m.workspacePath)
                .filter((wp): wp is string => !!wp),
            ),
          )
          const order = [...known, ...fromSessions.filter((k) => !known.includes(k))]
          const from = order.indexOf(p.key)
          const to = order.indexOf(over)
          if (from !== -1 && to !== -1) {
            order.splice(from, 1)
            order.splice(to, 0, p.key)
            void setProjectsOrder(order)
          }
        }
        // Swallow the click that follows the drag so the header doesn't toggle.
        suppressClickRef.current = true
        setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      projDraggingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setDragKey(null)
      setOverKey(null)
      setDragPos(null)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [setProjectsOrder])

  async function onNew() {
    const ctx = await lastSessionContext({
      provider: settings.defaultProvider,
      model: settings.defaultModel,
      reasoningEffort: settings.reasoningEffort,
    })
    const d = resolveSessionDefaults(ctx.workspacePath ? projectMeta[ctx.workspacePath] : undefined, settings)
    createDraft(d.provider, d.model, ctx.workspacePath, ctx.reasoningEffort)
    onOpenSession?.()
  }

  function onOpen(m: SessionMeta) {
    onOpenSession?.()
    void open(m.id)
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selAnchor = useRef<{ key: string; id: string } | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const liveSelected = useMemo(() => {
    if (selectedIds.size === 0) return [] as string[]
    const live = new Set(index.map((m) => m.id))
    return [...selectedIds].filter((id) => live.has(id))
  }, [selectedIds, index])

  function onRowClick(m: SessionMeta, group: { key: string; ids: string[] }, e: React.MouseEvent) {
    if (e.shiftKey && selAnchor.current?.key === group.key) {
      const a = group.ids.indexOf(selAnchor.current.id)
      const b = group.ids.indexOf(m.id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        setSelectedIds((prev) => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) next.add(group.ids[i])
          return next
        })
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(m.id)) next.delete(m.id)
        else next.add(m.id)
        return next
      })
      selAnchor.current = { key: group.key, id: m.id }
      return
    }
    if (selectedIds.size > 0) setSelectedIds(new Set())
    selAnchor.current = { key: group.key, id: m.id }
    onOpen(m)
  }

  function bulkDelete() {
    for (const id of liveSelected) void remove(id)
    setSelectedIds(new Set())
    setBulkDeleteOpen(false)
  }

  const [bulkMenu, setBulkMenu] = useState<{ x: number; y: number } | null>(null)

  function onRowContextMenu(m: SessionMeta, group: { key: string; ids: string[] }, e: React.MouseEvent) {
    e.preventDefault()
    if (!selectedIds.has(m.id)) {
      setSelectedIds(new Set([m.id]))
      selAnchor.current = { key: group.key, id: m.id }
    }
    setBulkMenu({ x: e.clientX, y: e.clientY })
  }

  function bulkMarkUnread() {
    for (const id of liveSelected) void patchSessionMeta(id, { unread: true })
    setSelectedIds(new Set())
    setBulkMenu(null)
  }
  function bulkArchive() {
    for (const id of liveSelected) void patchSessionMeta(id, { archived: true })
    setSelectedIds(new Set())
    setBulkMenu(null)
  }

  useEffect(() => {
    if (!bulkMenu) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBulkMenu(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [bulkMenu])

  function onWorktreeCreated(worktreePath: string) {
    const d = resolveSessionDefaults(undefined, settings)
    createDraft(d.provider, d.model, worktreePath)
    onOpenSession?.()
  }

  async function relinkFlow(oldPath: string) {
    const next = await pickWorkspaceFolder()
    if (next && next !== oldPath) await relinkProject(oldPath, next)
  }

  const visible = filtered.filter((m) => !m.archived)
  const pinnedItems = visible.filter((m) => m.pinned)
  const archivedItems = filtered.filter((m) => m.archived)

  // Group sessions by workspace; "" key = loose chats (pinned to the bottom).
  const grouped = groupByWorkspace(visible.filter((m) => !m.pinned))
  const map = new Map(grouped)
  const looseItems = map.get("") ?? []
  // Project keys = registry ∪ session-derived workspace paths. Registry keeps a
  // project visible even after its last chat is deleted. Display order follows
  // the project registry (manual drag order); session-derived paths not yet
  // registered are appended after.
  const sessionProjKeys = grouped.filter(([k]) => k !== "").map(([k]) => k)
  const projKeys = [
    ...knownProjects,
    ...sessionProjKeys.filter((k) => !knownProjects.includes(k)),
  ]
  const moveTargets = projKeys.map((p) => ({ path: p, name: projectMeta[p]?.name || basename(p) }))

  const listRef = useRef<HTMLDivElement | null>(null)
  const flipTopsRef = useRef<Map<string, number>>(new Map())
  const orderSig = projKeys.join("|")
  const prevOrderSigRef = useRef(orderSig)
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container) return
    const els = container.querySelectorAll<HTMLElement>("[data-proj-group]")
    const newTops = new Map<string, number>()
    els.forEach((el) => {
      const k = el.dataset.projGroup
      if (k) newTops.set(k, el.getBoundingClientRect().top)
    })
    if (prevOrderSigRef.current !== orderSig) {
      els.forEach((el) => {
        const k = el.dataset.projGroup
        if (!k) return
        const prev = flipTopsRef.current.get(k)
        const next = newTops.get(k)
        if (prev == null || next == null) return
        const dy = prev - next
        if (Math.abs(dy) < 1) return
        el.style.transition = "none"
        el.style.transform = `translateY(${dy}px)`
        requestAnimationFrame(() => {
          el.style.transition = "transform 220ms cubic-bezier(0.2, 0, 0, 1)"
          el.style.transform = ""
        })
      })
      prevOrderSigRef.current = orderSig
    }
    flipTopsRef.current = newTops
  })
  const renderSession = (
    m: SessionMeta,
    variant: "normal" | "archived" = "normal",
    group?: { key: string; ids: string[] },
  ) => (
    <SessionItem
      key={m.id}
      meta={m}
      active={activeId === m.id}
      selected={selectedIds.has(m.id)}
      streaming={!!streamingIds[m.id]}
      waiting={waitingIds.has(m.id)}
      variant={variant}
      moveTargets={moveTargets}
      onOpen={(e) => (group ? onRowClick(m, group, e) : onOpen(m))}
      onContextMenu={group ? (e) => onRowContextMenu(m, group, e) : undefined}
      onTogglePin={() => void patchSessionMeta(m.id, { pinned: !m.pinned })}
      onMarkUnread={() => void patchSessionMeta(m.id, { unread: true })}
      onRename={(title) => void patchSessionMeta(m.id, { title })}
      onSetHandle={(handle) => setHandleFor(m.id, handle)}
      onFork={() => void forkSession(m.id)}
      onMove={(path) => void patchSessionMeta(m.id, { workspacePath: path })}
      onArchive={() => void patchSessionMeta(m.id, { archived: true })}
      onUnarchive={() => void patchSessionMeta(m.id, { archived: false })}
      onDelete={() => void remove(m.id)}
    />
  )

  const renderGroup = (wsKey: string, items: SessionMeta[]) => (
    <ProjectGroup
      key={wsKey || "__loose__"}
      name={wsKey === "" ? t("sidebar.chats") : projectMeta[wsKey]?.name || basename(wsKey)}
      color={wsKey ? projectMeta[wsKey]?.color : undefined}
      isLoose={wsKey === ""}
      workspacePath={wsKey || undefined}
      collapsed={collapsed.has(wsKey)}
      onToggleCollapse={() => toggleCollapse(wsKey)}
      onNewInWorkspace={
        wsKey
          ? () => {
              const d = resolveSessionDefaults(projectMeta[wsKey], settings)
              createDraft(d.provider, d.model, wsKey)
            }
          : onNew
      }
      onNewWorktreeInWorkspace={wsKey ? () => setWorktreeRepo(wsKey) : undefined}
      onArchiveAllInWorkspace={
        items.length > 0
          ? () => {
              for (const it of items) void patchSessionMeta(it.id, { archived: true })
            }
          : undefined
      }
      onDeleteAllInWorkspace={
        wsKey && items.length > 0
          ? () => {
              for (const it of items) void remove(it.id)
            }
          : undefined
      }
      onRemoveProject={wsKey ? () => void removeProject(wsKey) : undefined}
      onRename={wsKey ? (next: string) => void setProjectMeta(wsKey, { name: next }) : undefined}
      onSetColor={wsKey ? (next: string) => void setProjectMeta(wsKey, { color: next }) : undefined}
      onRelink={wsKey ? () => void relinkFlow(wsKey) : undefined}
      onOpenInFinder={wsKey ? () => void openPathInFinder(wsKey) : undefined}
      projKey={wsKey || undefined}
      isDragging={wsKey !== "" && dragKey === wsKey}
      isDragOver={wsKey !== "" && overKey === wsKey}
      dropBelow={
        wsKey !== "" &&
        overKey === wsKey &&
        dragKey != null &&
        projKeys.indexOf(dragKey) < projKeys.indexOf(wsKey)
      }
      onHeaderMouseDown={
        wsKey !== "" ? (e) => startProjectDrag(wsKey, e) : undefined
      }
    >
      <ul className="flex flex-col gap-0.5">
        {items.map((m) => renderSession(m, "normal", { key: wsKey, ids: items.map((it) => it.id) }))}
      </ul>
    </ProjectGroup>
  )


  return (
    <>
    <aside
      aria-label={t("a11y.sidebarLandmark")}
      style={{ width: `${width}px` }}
      className="relative z-20 flex h-full shrink-0 flex-col overflow-hidden bg-codezal-sidebar"
    >
      {/* Resize handle — drag right edge to expand. 4px wide hit area, hover highlight. */}
      <div
        role="separator"
        aria-label={t("sidebar.resizeTitle")}
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_W}
        aria-valuemax={SIDEBAR_MAX_W}
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault()
            resizeBy(-8)
          } else if (e.key === "ArrowRight") {
            e.preventDefault()
            resizeBy(8)
          }
        }}
        title={t("sidebar.resizeTitle")}
        className="absolute right-0 top-0 z-40 h-full w-1 cursor-col-resize hover:bg-codezal-accent/30 focus-visible:bg-codezal-accent/30"
      />
      <div className="relative h-[48px] w-full">
        {/* Draggable background area that starts after the buttons to avoid blocking click events */}
        <div
          data-tauri-drag-region
          className={cn(
            "absolute inset-y-0 right-0 z-0",
            isMacOS() ? "left-[var(--tl-drag-left)]" : "left-[64px]",
          )}
        />
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title={t("sidebar.collapseSidebar")}
            aria-label={t("sidebar.collapseSidebar")}
            className={cn(
              "absolute top-[11px] z-20 flex h-[22px] w-[22px] items-center justify-center rounded text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text",
              isMacOS() ? "left-[89px]" : "left-[13px]",
            )}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-codezal-text transition-colors hover:bg-codezal-chip-soft"
        >
          <Send className="h-4 w-4 shrink-0 text-codezal-mute" aria-hidden />
          <span className="truncate">{t("sidebar.newSession")}</span>
          <span className="ml-auto shrink-0 text-xs font-normal text-codezal-mute">
            {fmtKbd("⌘N")}
          </span>
        </button>
        {onOpenRoutines && (
          <button
            type="button"
            onClick={onOpenRoutines}
            title={t("routinesOverlay.subtitle")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-codezal-text transition-colors hover:bg-codezal-chip-soft"
          >
            <ClockClockwise className="h-4 w-4 shrink-0 text-codezal-mute" aria-hidden />
            <span className="truncate">{t("sidebar.routines")}</span>
          </button>
        )}
      </div>

      {liveSelected.length > 0 && (
        <div className="mx-2 mb-1 flex items-center gap-1 rounded-lg border border-codezal-accent/40 bg-codezal-accent/10 px-2.5 py-1.5">
          <span className="flex-1 text-sm font-normal tabular-nums text-codezal-text">
            {liveSelected.length}
          </span>
          <button
            type="button"
            onClick={() => setBulkDeleteOpen(true)}
            title={t("common.delete")}
            className="flex h-6 items-center gap-1.5 rounded-md px-2 text-sm font-normal text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("common.delete")}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            title={t("common.cancel")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-2 pt-1">
        {filtered.length === 0 && knownProjects.length === 0 ? (
          <>
            <SectionLabel
              actions={
                <button
                  type="button"
                  onClick={onNewProject}
                  title={t("sidebar.newProject")}
                  aria-label={t("sidebar.newProject")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              }
            >
              {t("sidebar.projects")}
            </SectionLabel>
            <div className="px-2 py-5 text-sm text-codezal-mute">{t("sidebar.noSessions")}</div>
          </>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <SidebarSection
                icon={<Pin className="h-4 w-4" />}
                label="Sabitlenenler"
                collapsed={collapsed.has("__pinned__")}
                onToggle={() => toggleCollapse("__pinned__")}
              >
                {pinnedItems.map((m) =>
                  renderSession(m, "normal", { key: "__pinned__", ids: pinnedItems.map((it) => it.id) }),
                )}
              </SidebarSection>
            )}
            {projKeys.length > 0 && (
              <SectionLabel
                actions={
                  <div className="flex items-center gap-0.5">
                    {onOpenSearch && (
                      <button
                        type="button"
                        onClick={onOpenSearch}
                        title={t("common.search")}
                        aria-label={t("common.search")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onNewProject}
                      title={t("sidebar.newProject")}
                      aria-label={t("sidebar.newProject")}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                }
              >
                {t("sidebar.projects")}
              </SectionLabel>
            )}
            {projKeys.map((k) => renderGroup(k, map.get(k) ?? []))}
            {looseItems.length > 0 && (
              <>
                <SectionLabel>{t("sidebar.chats")}</SectionLabel>
                <ul className="flex flex-col gap-0.5">
                  {looseItems.map((m) =>
                    renderSession(m, "normal", { key: "", ids: looseItems.map((it) => it.id) }),
                  )}
                </ul>
              </>
            )}
            {archivedItems.length > 0 && (
              <SidebarSection
                icon={<Archive className="h-4 w-4" />}
                label={t("sidebar.archived")}
                collapsed={!archivedOpen}
                onToggle={() => setArchivedOpen((v) => !v)}
              >
                {archivedItems.map((m) =>
                  renderSession(m, "archived", { key: "__archived__", ids: archivedItems.map((it) => it.id) }),
                )}
              </SidebarSection>
            )}
          </>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1 border-t border-codezal-panel px-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-sm text-codezal-text transition-colors hover:bg-codezal-panel-2"
        >
          <Settings className="h-4 w-4 text-codezal-mute" />
          <span>{t("sidebar.settings")}</span>
        </button>
      </div>
    </aside>
    {dragKey && dragPos &&
      createPortal(
        <div
          className="pointer-events-none fixed z-[9999] flex max-w-[220px] items-center gap-1.5 rounded-md border border-codezal-strong bg-codezal-panel px-2 py-1 text-sm text-codezal-text shadow-lg"
          style={{
            left: dragPos.x + 12,
            top: dragPos.y + 8,
            transform: "rotate(-2deg)",
          }}
        >
          <Folder
            className="h-4 w-4 shrink-0 text-codezal-mute"
            style={projectMeta[dragKey]?.color ? { color: projectMeta[dragKey]?.color } : undefined}
          />
          <span className="truncate">
            {projectMeta[dragKey]?.name || basename(dragKey)}
          </span>
        </div>,
        document.body,
      )}
      <NewWorktreeDialog
        repoPath={worktreeRepo}
        onClose={() => setWorktreeRepo(null)}
        onCreated={onWorktreeCreated}
      />
      {bulkMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setBulkMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setBulkMenu(null)
            }}
          />
          <div
            style={{
              position: "fixed",
              top: Math.min(bulkMenu.y, window.innerHeight - 160),
              left: Math.min(bulkMenu.x, window.innerWidth - 200),
            }}
            className="z-50 min-w-[180px] cz-menu p-1 text-base"
          >
            <MenuItem icon={<Circle className="h-4 w-4 shrink-0" />} onClick={bulkMarkUnread}>
              {t("sidebar.markUnread")} ({liveSelected.length})
            </MenuItem>
            <MenuItem icon={<Archive className="h-4 w-4 shrink-0" />} onClick={bulkArchive}>
              {t("sidebar.archive")} ({liveSelected.length})
            </MenuItem>
            <div className="my-1 h-px bg-codezal-hair" />
            <MenuItem
              danger
              icon={<Trash2 className="h-4 w-4 shrink-0" />}
              onClick={() => {
                setBulkMenu(null)
                setBulkDeleteOpen(true)
              }}
            >
              {t("common.delete")} ({liveSelected.length})
            </MenuItem>
          </div>
        </>
      )}
      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t("sidebar.deleteSessionConfirmTitle")}
        message={t("sidebar.deleteSessionConfirmMsg")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={bulkDelete}
      />
    </>
  )
}

// Bound projects (workspacePath !== "") get + (new session in this workspace)
// and ⋯ (context menu) on hover. Loose chats group hides both.
const PROJECT_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"]

function readableOn(hex: string): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? "#171717" : "#ffffff"
}

function ProjectGroup({
  name,
  color,
  isLoose,
  workspacePath,
  collapsed,
  onToggleCollapse,
  onNewInWorkspace,
  onNewWorktreeInWorkspace,
  onArchiveAllInWorkspace,
  onDeleteAllInWorkspace,
  onRemoveProject,
  onRename,
  onSetColor,
  onRelink,
  onOpenInFinder,
  projKey,
  isDragging,
  isDragOver,
  dropBelow,
  onHeaderMouseDown,
  children,
}: {
  name: string
  color?: string
  isLoose?: boolean
  workspacePath?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
  onNewInWorkspace?: () => void
  onNewWorktreeInWorkspace?: () => void
  onArchiveAllInWorkspace?: () => void
  onDeleteAllInWorkspace?: () => void
  onRemoveProject?: () => void
  onRename?: (name: string) => void
  onSetColor?: (color: string) => void
  onRelink?: () => void
  onOpenInFinder?: () => void
  projKey?: string
  isDragging?: boolean
  isDragOver?: boolean
  dropBelow?: boolean
  onHeaderMouseDown?: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 8 })
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [confirmKind, setConfirmKind] = useState<null | "deleteAll" | "removeProject">(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const estH = 320
      const up = window.innerHeight - r.bottom < estH && r.top > estH
      setMenuPos({
        right: Math.max(8, window.innerWidth - r.right),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    setMenuOpen(true)
  }

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onLeave() { setMenuOpen(false) }
    function onScroll(e: Event) {
      const tgt = e.target as Node | null
      if (tgt && tgt.contains(btnRef.current)) onLeave()
    }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onLeave)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onLeave)
    }
  }, [menuOpen])

  const FolderIcon = collapsed ? Folder : FolderOpen

  return (
    <div className="group/proj relative mb-1.5" data-proj-group={projKey}>
      {isDragOver && !dropBelow && (
        <div className="drop-ind pointer-events-none absolute inset-x-1 -top-[3px] z-10 flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-codezal-accent ring-accent-glow" />
          <span className="h-[3px] flex-1 rounded-full bg-codezal-accent ring-accent-glow" />
        </div>
      )}
      <div
        data-proj-key={projKey}
        onMouseDown={onHeaderMouseDown}
        className={cn(
          "relative flex items-center gap-1 px-1.5 py-1 transition-opacity",
          onHeaderMouseDown && "cursor-grab active:cursor-grabbing",
          isDragging && "rounded-md bg-codezal-panel-2 opacity-40",
        )}
      >
        {/* Rename modu: header toggle yerine inline input. */}
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5 py-0.5">
            <FolderIcon
              className="h-4 w-4 shrink-0 text-codezal-mute"
              style={color ? { color } : undefined}
            />
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename?.(draftName.trim())
                  setRenaming(false)
                } else if (e.key === "Escape") {
                  setRenaming(false)
                }
              }}
              onBlur={() => setRenaming(false)}
              placeholder={name}
              className="min-w-0 flex-1 rounded bg-codezal-panel-2 px-1 py-0.5 text-sm text-codezal-text outline-none"
            />
          </div>
        ) : (
          /* Header acts as a show/hide toggle for the group's chats. */
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? t("sidebar.showChats") : t("sidebar.hideChats")}
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left hover:bg-codezal-chip-soft"
          >
            {isLoose ? (
              <MessageSquare className="h-4 w-4 shrink-0 text-codezal-mute" />
            ) : (
              <FolderIcon
                className="h-4 w-4 shrink-0 text-codezal-mute"
                style={color ? { color } : undefined}
              />
            )}
            <span className="min-w-0 truncate text-sm font-medium text-codezal-text">
              {name}
            </span>
            <span className="flex-1" />
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-codezal-dim opacity-70 transition-transform group-hover/proj:opacity-100",
                !collapsed && "rotate-90",
              )}
              aria-hidden
            />
          </button>
        )}
        {(onNewInWorkspace || !isLoose) && (
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity",
              menuOpen ? "opacity-100" : "opacity-0 group-hover/proj:opacity-100",
            )}
          >
            {onNewInWorkspace && (
              <button
                type="button"
                onClick={onNewInWorkspace}
                title={t("sidebar.newChat")}
                aria-label={t("sidebar.newChat")}
                className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            {!isLoose && (
            <div ref={menuRef}>
              <button
                ref={btnRef}
                type="button"
                onClick={toggleMenu}
                title={t("sidebar.projectOptions")}
                aria-label={t("sidebar.projectOptions")}
                className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }} className="z-50 max-h-[70vh] min-w-[220px] overflow-y-auto cz-menu p-1 text-base">
                  {onNewInWorkspace && (
                    <MenuItem
                      icon={<Plus className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        onNewInWorkspace()
                      }}
                    >
                      {t("sidebar.newChat")}
                    </MenuItem>
                  )}
                  {onNewWorktreeInWorkspace && workspacePath && (
                    <MenuItem
                      icon={<GitBranch className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        onNewWorktreeInWorkspace()
                      }}
                    >
                      {t("sidebar.newWorktreeChat")}
                    </MenuItem>
                  )}
                  {onOpenInFinder && workspacePath && (
                    <MenuItem
                      icon={<ExternalLink className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        onOpenInFinder()
                      }}
                    >
                      {t("sidebar.openInFinder")}
                    </MenuItem>
                  )}
                  {onRename && (
                    <MenuItem
                      icon={<Pencil className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        setDraftName(name)
                        setRenaming(true)
                      }}
                    >
                      {t("sidebar.rename")}
                    </MenuItem>
                  )}
                  {onRelink && (
                    <MenuItem
                      icon={<FolderPlus className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        onRelink()
                      }}
                    >
                      {t("sidebar.relink")}
                    </MenuItem>
                  )}
                  {onSetColor && (
                    <>
                      <div className="my-1 h-px bg-codezal-hair" />
                      <div className="px-2 pb-1 pt-0.5">
                        <div className="mb-2 flex items-center gap-1.5 px-0.5 text-codezal-mute">
                          <Palette className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-sm font-normal uppercase tracking-wider">
                            {t("sidebar.colorHeading")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 px-0.5">
                          {PROJECT_COLORS.map((c) => {
                            const selected = color === c
                            return (
                              <button
                                key={c}
                                type="button"
                                title={c}
                                aria-pressed={selected}
                                onClick={() => {
                                  onSetColor(c)
                                  setMenuOpen(false)
                                }}
                                className={cn(
                                  "relative h-4 w-4 rounded-full outline-none transition-transform duration-100 hover:scale-110 focus-visible:scale-110",
                                  selected
                                    ? "ring-2 ring-offset-1 ring-offset-codezal-panel"
                                    : "ring-1 ring-inset ring-black/20",
                                )}
                                style={{
                                  backgroundColor: c,
                                  ...(selected
                                    ? ({ "--tw-ring-color": c } as React.CSSProperties)
                                    : {}),
                                }}
                              >
                                {selected && (
                                  <Check
                                    className="absolute inset-0 m-auto h-2.5 w-2.5"
                                    strokeWidth={3}
                                    style={{ color: readableOn(c) }}
                                  />
                                )}
                              </button>
                            )
                          })}
                          <div className="mx-0.5 h-3.5 w-px bg-codezal-hair" />
                          <button
                            type="button"
                            title={t("sidebar.clearColor")}
                            aria-pressed={!color}
                            onClick={() => {
                              onSetColor("")
                              setMenuOpen(false)
                            }}
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded-full border border-dashed transition-colors",
                              color
                                ? "border-codezal-hair text-codezal-mute hover:border-codezal-text/40 hover:text-codezal-text"
                                : "border-solid border-codezal-accent text-codezal-accent",
                            )}
                          >
                            <X className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {onArchiveAllInWorkspace && (
                    <MenuItem
                      icon={<Archive className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        onArchiveAllInWorkspace()
                      }}
                    >
                      {t("sidebar.archiveAll")}
                    </MenuItem>
                  )}
                  {(onDeleteAllInWorkspace || onRemoveProject) && (
                    <div className="my-1 h-px bg-codezal-hair" />
                  )}
                  {onDeleteAllInWorkspace && (
                    <MenuItem
                      danger
                      icon={<Trash2 className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        setConfirmKind("deleteAll")
                      }}
                    >
                      {t("sidebar.deleteAll")}
                    </MenuItem>
                  )}
                  {onRemoveProject && (
                    <MenuItem
                      danger
                      icon={<X className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        setMenuOpen(false)
                        setConfirmKind("removeProject")
                      }}
                    >
                      {t("sidebar.removeProject")}
                    </MenuItem>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>
      {!collapsed && children}
      {isDragOver && dropBelow && (
        <div className="drop-ind pointer-events-none absolute inset-x-1 -bottom-[3px] z-10 flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-codezal-accent ring-accent-glow" />
          <span className="h-[3px] flex-1 rounded-full bg-codezal-accent ring-accent-glow" />
        </div>
      )}
      <ConfirmDialog
        open={confirmKind !== null}
        title={
          confirmKind === "removeProject"
            ? t("sidebar.removeProjectConfirmTitle", { name })
            : t("sidebar.deleteAllConfirmTitle", { name })
        }
        message={
          confirmKind === "removeProject"
            ? t("sidebar.removeProjectConfirmMsg")
            : t("sidebar.irreversible")
        }
        confirmLabel={confirmKind === "removeProject" ? t("common.remove") : t("common.delete")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => {
          const kind = confirmKind
          setConfirmKind(null)
          if (kind === "removeProject") onRemoveProject?.()
          else if (kind === "deleteAll") onDeleteAllInWorkspace?.()
        }}
      />
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
  icon,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-codezal-text hover:bg-codezal-panel-2",
      )}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}

function SidebarSection({
  icon,
  label,
  collapsed,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  label: string
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="group/sec mb-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-codezal-chip-soft"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-codezal-dim opacity-70 transition-transform group-hover/sec:opacity-100",
            !collapsed && "rotate-90",
          )}
          aria-hidden
        />
        <span className="shrink-0 text-codezal-dim">{icon}</span>
        <span className="min-w-0 truncate text-sm font-medium text-codezal-dim">{label}</span>
        <span className="flex-1" />
      </button>
      {!collapsed && <ul className="flex flex-col gap-0.5">{children}</ul>}
    </div>
  )
}

// Tauri webview scroll-clip sorunu olmaz).
function SessionItem({
  meta,
  active,
  selected,
  streaming,
  waiting,
  variant,
  moveTargets,
  onOpen,
  onContextMenu,
  onTogglePin,
  onMarkUnread,
  onRename,
  onSetHandle,
  onFork,
  onMove,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  meta: SessionMeta
  active: boolean
  selected: boolean
  streaming: boolean
  waiting: boolean
  variant: "normal" | "archived"
  moveTargets: { path: string; name: string }[]
  onOpen: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onTogglePin: () => void
  onMarkUnread: () => void
  onRename: (title: string) => void
  onSetHandle: (handle: string | undefined) => void
  onFork: () => void
  onMove: (path?: string) => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [editExtra, setEditExtra] = useState<null | "handle" | "quick">(null)
  const [draftExtra, setDraftExtra] = useState("")
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(
    null,
  )
  const menuRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const closeMenu = () => {
    setMenuOpen(false)
    setMoveOpen(false)
  }

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu()
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const estH = variant === "archived" ? 100 : 330
      const up = window.innerHeight - r.bottom < estH && r.top > estH
      setMenuPos({
        right: Math.max(8, window.innerWidth - r.right),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    setMenuOpen(true)
  }

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setMoveOpen(false)
      }
    }
    function onLeave() {
      setMenuOpen(false)
      setMoveOpen(false)
    }
    function onScroll(e: Event) {
      const tgt = e.target as Node | null
      if (tgt && tgt.contains(btnRef.current)) onLeave()
    }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onLeave)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onLeave)
    }
  }, [menuOpen])

  const title =
    meta.title.startsWith("/") && meta.title.lastIndexOf("/") > 0 ? basename(meta.title) : meta.title
  const locale = useLocale()

  return (
    <li>
      <div
        onPointerDown={
          renaming || editExtra
            ? undefined
            : (e) =>
                startInternalDrag(
                  e,
                  { kind: "session", payload: meta.id, label: title },
                  {
                    onStart: () =>
                      window.dispatchEvent(
                        new CustomEvent("codezal:session-drag", { detail: { active: true } }),
                      ),
                    onEnd: () =>
                      window.dispatchEvent(
                        new CustomEvent("codezal:session-drag", { detail: { active: false } }),
                      ),
                  },
                )
        }
        onContextMenu={onContextMenu}
        className={cn(
          "group relative flex items-center rounded-md py-1.5 pl-7 pr-1 text-sm transition-colors",
          selected
              ? "bg-codezal-panel-2 text-codezal-text"
              : active
              ? "bg-codezal-chip font-medium text-codezal-text shadow-sm ring-1 ring-inset ring-codezal-text/10 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-codezal-text/70"
              : "text-codezal-dim hover:bg-codezal-chip-soft hover:text-codezal-text",
        )}
      >
        {(waiting || streaming || meta.unread) && (
          <span
            className={cn(
              "pointer-events-none absolute left-2.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full",
              waiting
                ? "animate-pulse bg-amber-400"
                : streaming
                  ? "animate-pulse bg-codezal-accent"
                  : "bg-blue-500",
            )}
          />
        )}
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = draftName.trim()
                if (v) onRename(v)
                setRenaming(false)
              } else if (e.key === "Escape") {
                setRenaming(false)
              }
            }}
            onBlur={() => setRenaming(false)}
            className="min-w-0 flex-1 rounded bg-codezal-panel-2 px-1 py-0.5 text-sm text-codezal-text outline-none"
          />
        ) : editExtra ? (
          <input
            autoFocus
            value={draftExtra}
            placeholder={
              editExtra === "handle"
                ? t("sidebar.handlePlaceholder")
                : t("sidebar.quickSendPlaceholder")
            }
            onChange={(e) => setDraftExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = draftExtra.trim()
                if (editExtra === "handle") {
                  if (!v) {
                    onSetHandle(undefined)
                  } else {
                    const nh = normHandle(v)
                    if (!nh) {
                      toast.error(t("sidebar.handleInvalid"))
                      return
                    }
                    if (handleTaken(useSessionsStore.getState().index, nh, meta.id)) {
                      toast.error(t("sidebar.handleTakenMsg"))
                      return
                    }
                    onSetHandle(v)
                  }
                } else if (v) {
                  // (App'in session-message-bus dinleyicisi teslim eder).
                  emitSessionMessage({
                    toSessionId: meta.id,
                    fromLabel: `"${t("sidebar.quickSendFrom")}"`,
                    text: v,
                  })
                  toast.success(t("sidebar.quickSendDone"))
                }
                setEditExtra(null)
                setDraftExtra("")
              } else if (e.key === "Escape") {
                setEditExtra(null)
                setDraftExtra("")
              }
            }}
            onBlur={() => {
              setEditExtra(null)
              setDraftExtra("")
            }}
            className="min-w-0 flex-1 rounded bg-codezal-panel-2 px-1 py-0.5 text-sm text-codezal-text outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              if (wasDragging()) return
              onOpen(e)
            }}
            onDoubleClick={() => {
              setDraftName(title)
              setRenaming(true)
            }}
            aria-current={active ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
          >
            {meta.forkParentId && (
              <GitBranch className="h-3 w-3 shrink-0 text-codezal-mute" aria-label={t("sidebar.forkAria")} />
            )}
            {meta.handle && (
              <span
                className="shrink-0 rounded bg-codezal-panel-2 px-1 text-[10px] font-medium leading-tight text-codezal-mute"
                title={t("sidebar.handleAria")}
              >
                @{meta.handle}
              </span>
            )}
            <span className="truncate">{title}</span>
          </button>
        )}
        {!renaming && !editExtra && (
          <span className="ml-1 shrink-0 text-xs tabular-nums text-codezal-mute transition-opacity group-hover:opacity-0">
            {formatRowTime(meta.updatedAt, locale)}
          </span>
        )}
        <div className="ml-1 shrink-0" ref={menuRef}>
          <button
            ref={btnRef}
            type="button"
            onClick={toggleMenu}
            title={t("sidebar.sessionOptions")}
            aria-label={t("sidebar.sessionOptions")}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-codezal-mute transition hover:bg-codezal-panel-2 hover:text-codezal-text",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && menuPos && (
            <div
              style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }}
              className="z-50 max-h-[70vh] min-w-[200px] overflow-y-auto cz-menu p-1 text-base"
            >
              {variant === "normal" ? (
                <>
                  <MenuItem
                    icon={
                      meta.pinned ? (
                        <PinOff className="h-4 w-4 shrink-0" />
                      ) : (
                        <Pin className="h-4 w-4 shrink-0" />
                      )
                    }
                    onClick={() => {
                      closeMenu()
                      onTogglePin()
                    }}
                  >
                    {meta.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                  </MenuItem>
                  {!meta.unread && (
                    <MenuItem
                      icon={<Circle className="h-4 w-4 shrink-0" />}
                      onClick={() => {
                        closeMenu()
                        onMarkUnread()
                      }}
                    >
                      {t("sidebar.markUnread")}
                    </MenuItem>
                  )}
                  <MenuItem
                    icon={<Pencil className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMenuOpen(false)
                      setMoveOpen(false)
                      setDraftName(meta.title)
                      setRenaming(true)
                    }}
                  >
                    {t("sidebar.rename")}
                  </MenuItem>
                  <MenuItem
                    icon={<AtSign className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMenuOpen(false)
                      setMoveOpen(false)
                      setDraftExtra(meta.handle ?? "")
                      setEditExtra("handle")
                    }}
                  >
                    {meta.handle ? t("sidebar.editHandle") : t("sidebar.setHandle")}
                  </MenuItem>
                  <MenuItem
                    icon={<Send className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      setMenuOpen(false)
                      setMoveOpen(false)
                      setDraftExtra("")
                      setEditExtra("quick")
                    }}
                  >
                    {t("sidebar.quickSend")}
                  </MenuItem>
                  <MenuItem
                    icon={<GitBranch className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      closeMenu()
                      onFork()
                    }}
                  >
                    {t("sidebar.fork")}
                  </MenuItem>
                  <MenuItem
                    icon={<FolderOpen className="h-4 w-4 shrink-0" />}
                    onClick={() => setMoveOpen((v) => !v)}
                  >
                    {t("sidebar.moveToGroup")}
                  </MenuItem>
                  {moveOpen && (
                    <div className="ml-2 border-l border-codezal-hair pl-1">
                      {moveTargets.map((tgt) => {
                        const cur = meta.workspacePath === tgt.path
                        return (
                          <MenuItem
                            key={tgt.path}
                            icon={
                              cur ? (
                                <Check className="h-4 w-4 shrink-0" />
                              ) : (
                                <Folder className="h-4 w-4 shrink-0" />
                              )
                            }
                            onClick={() => {
                              if (cur) return
                              closeMenu()
                              onMove(tgt.path)
                            }}
                          >
                            {tgt.name}
                          </MenuItem>
                        )
                      })}
                      <MenuItem
                        icon={
                          meta.workspacePath == null ? (
                            <Check className="h-4 w-4 shrink-0" />
                          ) : (
                            <MessageSquare className="h-4 w-4 shrink-0" />
                          )
                        }
                        onClick={() => {
                          if (meta.workspacePath == null) return
                          closeMenu()
                          onMove(undefined)
                        }}
                      >
                        {t("sidebar.looseGroup")}
                      </MenuItem>
                    </div>
                  )}
                  <div className="my-1 h-px bg-codezal-hair" />
                  <MenuItem
                    icon={<Archive className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      closeMenu()
                      onArchive()
                    }}
                  >
                    {t("sidebar.archive")}
                  </MenuItem>
                  <div className="my-1 h-px bg-codezal-hair" />
                  <MenuItem
                    danger
                    icon={<Trash2 className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      closeMenu()
                      setConfirmDelete(true)
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                </>
              ) : (
                <>
                  <MenuItem
                    icon={<Archive className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      closeMenu()
                      onUnarchive()
                    }}
                  >
                    {t("sidebar.unarchive")}
                  </MenuItem>
                  <div className="my-1 h-px bg-codezal-hair" />
                  <MenuItem
                    danger
                    icon={<Trash2 className="h-4 w-4 shrink-0" />}
                    onClick={() => {
                      closeMenu()
                      setConfirmDelete(true)
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t("sidebar.deleteSessionConfirmTitle")}
        message={t("sidebar.deleteSessionConfirmMsg")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </li>
  )
}

export { Sparkles as TitleSpark }

// Reveal a workspace path in Finder/Explorer/Files via Tauri opener.
async function openPathInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path)
  } catch (e) {
    console.warn("[sidebar] revealItemInDir failed:", e)
  }
}

function groupByWorkspace(items: SessionMeta[]): Array<[string, SessionMeta[]]> {
  const map = new Map<string, SessionMeta[]>()
  for (const it of items) {
    const k = it.workspacePath ?? ""
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(it)
  }
  const entries = Array.from(map.entries())
  entries.sort(([ak, av], [bk, bv]) => {
    if (ak === "" && bk !== "") return -1
    if (bk === "" && ak !== "") return 1
    const am = Math.max(...av.map((x) => x.updatedAt))
    const bm = Math.max(...bv.map((x) => x.updatedAt))
    return bm - am
  })
  return entries
}
