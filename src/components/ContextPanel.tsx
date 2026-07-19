import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Bot, Check, ChevronRight, ClipboardCopy, ClipboardPaste, Copy, ExternalLink, Eye, FileText, FolderOpen, FolderPlus, ListChecks, MessageSquarePlus, Pencil, Plus, Scissors, Search, ShieldCheck, Sparkles, Trash2, X } from "@/lib/icons"
import { FileTypeIcon, FolderTypeIcon } from "@/lib/file-icons"
import { mkdir, rename, remove, exists } from "@tauri-apps/plugin-fs"
import { readTextFileSafe, writeTextFileSafe } from "@/lib/fs-safe"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { Identicon } from "@/lib/identicon"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { readWorkspaceDir, type FsEntry } from "@/lib/workspace-tree"
import { listDirShallow, type DirEntry } from "@/lib/fs-browse"
import { startInternalDrag, wasDragging } from "@/lib/internal-drag"
import { readProjectMemory, readUserMemory, invalidateMemoryCache, type MemoryFile } from "@/lib/memory"
import { memoryTargetPath } from "@/lib/memory-write"
import { listAllSkills, type Skill } from "@/lib/skills"
import { readWorkspaceAgents, readUserAgents, type AgentDef } from "@/lib/agents"
import { AgentCard } from "./AgentCard"
import type { AgentCardPart } from "@/lib/orchestra/types"
import { GitPanel } from "./GitPanel"
import { PreviewPanel } from "./PreviewPanel"
import { SddRequirementView } from "./sdd/SddRequirementView"
import { TodoList } from "./TodoList"
import { SuggestionsPanel } from "./SuggestionsPanel"
import { type PanelMode, MODE_ICON, modeLabel } from "@/lib/panel-modes"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStaticCtx } from "@/lib/i18n"
import { errorMessage } from "@/lib/errors"
import { watchWorkspace } from "@/lib/file-watcher"
import { invalidateFromFileEvent } from "@/lib/file-invalidate"
import { normalizeFsPath, invalidateFileContent } from "@/lib/file-content-cache"
import { subscribeDirRefresh, dirHasSubscribers, emitDirRefresh } from "@/lib/dir-refresh-bus"
import { subscribeExpand, emitExpand } from "@/lib/tree-expand-bus"
import { EditorContextMenu, type CtxMenuItem } from "./EditorContextMenu"
import { ConfirmDialog } from "./ConfirmDialog"
import { PromptDialog } from "./PromptDialog"
import { detectEditors, openInEditor, EDITOR_LABELS, type EditorId } from "@/lib/editors"
import { insertToFocusedComposer } from "@/lib/composer-drop"
import { isMacOS } from "@/lib/platform"
import { toast } from "@/store/toast"
import {
  getFileClipboard,
  setFileClipboard,
  subscribeFileClipboard,
  applyFileClipboardPaste,
} from "@/lib/file-clipboard"
import { joinFsPath } from "@/lib/fs-path"

type Props = {
  mode: PanelMode
  onClose: () => void
  onModeChange?: (mode: PanelMode) => void
  onSend?: (text: string) => void
  onOpenPreview?: (absPath: string) => void
  onBuild?: (draftId: string, planPath: string) => void
}

const EMPTY_DISABLED: string[] = []

type MenuTarget = { path: string; name: string; isDir: boolean }
type FileTreeMenuValue = {
  open: (e: React.MouseEvent, target: MenuTarget) => void
  activePath: string | null
}
const FileTreeMenuCtx = createContext<FileTreeMenuValue | null>(null)

function parentDir(p: string): string {
  return p.replace(/[/\\][^/\\]*$/, "")
}
function relTo(root: string, p: string): string {
  const np = p.replace(/\\/g, "/")
  const nr = root.replace(/\\/g, "/").replace(/\/$/, "")
  return np.startsWith(nr) ? np.slice(nr.length).replace(/^\//, "") : np
}
function validName(name: string): boolean {
  return name.length > 0 && !/[/\\]/.test(name) && name !== "." && name !== ".."
}
function isUnderOrEqual(child: string, base: string): boolean {
  const c = child.replace(/\\/g, "/")
  const b = base.replace(/\\/g, "/")
  return c === b || c.startsWith(b + "/")
}

const PANEL_W_KEY = "codezal.contextPanel.width"
const PANEL_W_MIN = 240
const PANEL_W_MAX = 1200
const PANEL_W_DEFAULT = 320
// Preview (iframe) also wants to be wide; its own key so it doesn't fight the others.
const PANEL_W_KEY_PREVIEW = "codezal.contextPanel.previewWidth"
const PANEL_W_PREVIEW_DEFAULT = 640

export function ContextPanel({ mode, onClose, onModeChange, onSend, onOpenPreview, onBuild }: Props) {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const ws = active?.workspacePath
  const isPreview = mode === "preview"
  const isSdd = mode === "sdd"
  const isFiles = mode === "files"
  const isWorkspaceDock = isFiles || mode === "git" || mode === "review"
  const isFlush = isPreview || isSdd

  const storageKey = isPreview || isSdd ? PANEL_W_KEY_PREVIEW : PANEL_W_KEY
  const defaultW = isPreview || isSdd ? PANEL_W_PREVIEW_DEFAULT : PANEL_W_DEFAULT
  const [width, setWidth] = useState<number>(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n >= PANEL_W_MIN && n <= PANEL_W_MAX ? n : defaultW
  })

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey)
    const n = raw ? Number(raw) : NaN
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(Number.isFinite(n) && n >= PANEL_W_MIN && n <= PANEL_W_MAX ? n : defaultW)
  }, [storageKey, defaultW])

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width))
  }, [storageKey, width])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    function onMove(ev: MouseEvent) {
      const delta = startX - ev.clientX
      const next = Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, startW + delta))
      setWidth(next)
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  function resizeBy(delta: number) {
    setWidth((current) => Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, current + delta)))
  }

  return (
    <aside
      aria-label={t("a11y.contextLandmark")}
      style={{ width }}
      className="relative z-20 flex shrink-0 self-stretch flex-col overflow-hidden border-l border-codezal-panel bg-codezal-sidebar max-[900px]:fixed max-[900px]:bottom-9 max-[900px]:right-0 max-[900px]:top-[44px] max-[900px]:max-w-[calc(100vw-1rem)] max-[900px]:shadow-2xl"
    >
      <div
        role="separator"
        aria-label={t("contextPanel.resizeTitle")}
        aria-orientation="vertical"
        aria-valuemin={PANEL_W_MIN}
        aria-valuemax={PANEL_W_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault()
            resizeBy(12)
          } else if (e.key === "ArrowRight") {
            e.preventDefault()
            resizeBy(-12)
          }
        }}
        className="group absolute left-0 top-0 z-20 h-full w-[6px] -translate-x-[3px] cursor-col-resize focus-visible:outline-none"
        title={t("contextPanel.resizeTitle")}
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-codezal-hair transition-colors group-hover:bg-codezal-accent group-focus-visible:bg-codezal-accent" />
      </div>
      {isWorkspaceDock ? (
        <WorkspaceDockHeader mode={mode} onChange={onModeChange} onClose={onClose} />
      ) : (
        !isFlush && <PanelHeader mode={mode} onClose={onClose} />
      )}
      <div
        className={cn(
          "flex-1 min-h-0",
          isFlush ? "flex" : "overflow-y-auto px-3.5 py-3",
        )}
      >
        {mode === "files" && <FilesSection workspacePath={ws} />}
        {mode === "git" && <GitPanel workspacePath={ws} surface="changes" />}
        {mode === "review" && <GitPanel workspacePath={ws} surface="review" />}
        {mode === "agents" && <AgentsSection workspacePath={ws} />}
        {mode === "skills" && <SkillsSection workspacePath={ws} />}
        {mode === "memory" && <MemorySection workspacePath={ws} />}
        {mode === "rules" && <RulesSection workspacePath={ws} />}
        {mode === "preview" && <PreviewPanel workspacePath={ws} onClose={onClose} />}
        {mode === "sdd" && (
          <SddRequirementView onSend={onSend} onClose={onClose} onOpenPreview={onOpenPreview} onBuild={onBuild} />
        )}
        {mode === "todo" && <TodoSection />}
        {mode === "suggestions" && <SuggestionsPanel />}
      </div>
    </aside>
  )
}

function WorkspaceDockHeader({
  mode,
  onChange,
  onClose,
}: {
  mode: PanelMode
  onChange?: (mode: PanelMode) => void
  onClose: () => void
}) {
  const t = useT()
  const tabs: Array<{ mode: "files" | "git" | "review"; label: string }> = [
    { mode: "files", label: t("tabBar.modeFiles") },
    { mode: "git", label: t("prPanel.changes") },
    { mode: "review", label: t("prPanel.aiReview") },
  ]

  return (
    <div className="flex h-11 shrink-0 items-end border-b border-codezal-panel bg-codezal-sidebar px-2">
      <nav aria-label={t("a11y.contextLandmark")} className="flex min-w-0 flex-1 items-end gap-0.5">
        {tabs.map((tab) => {
          const active = mode === tab.mode
          return (
            <button
              key={tab.mode}
              type="button"
              aria-pressed={active}
              onClick={() => onChange?.(tab.mode)}
              className={cn(
                "relative h-10 min-w-0 px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-codezal-accent/45",
                active
                  ? "text-codezal-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-codezal-accent"
                  : "text-codezal-mute hover:text-codezal-text",
              )}
            >
              <span className="block truncate">{tab.label}</span>
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={onClose}
        title={t("contextPanel.panelClose")}
        aria-label={t("contextPanel.panelClose")}
        className="mb-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/45"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function PanelHeader({ mode, onClose }: { mode: PanelMode; onClose: () => void }) {
  const Icon = MODE_ICON[mode]
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-codezal-panel bg-codezal-sidebar px-3.5">
      <Icon className="h-4 w-4 shrink-0 text-codezal-dim" />
      <span className="flex-1 truncate text-md font-medium text-codezal-text">
        {modeLabel(mode)}
      </span>
      <button
        type="button"
        onClick={onClose}
        title={tStaticCtx("contextPanel.panelClose")}
        aria-label={tStaticCtx("contextPanel.panelClose")}
        className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function SectionHead({ label, right }: { label: string; right?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-sm font-semibold uppercase tracking-[0.08em] text-codezal-mute">
        {label}
      </span>
      {right && <span className="text-sm text-codezal-mute">{right}</span>}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon className="h-7 w-7 text-codezal-mute" />
      <div className="text-md text-codezal-dim">{title}</div>
      {children && (
        <div className="text-sm leading-relaxed text-codezal-mute">{children}</div>
      )}
    </div>
  )
}

function TodoSection() {
  const t = useT()
  const todos = useSessionsStore((s) => s.active?.todos)
  const done = (todos ?? []).filter(
    (x) => x.status === "completed" || x.status === "cancelled",
  ).length

  return (
    <div>
      <SectionHead
        label={t("contextPanel.todoHeading")}
        right={todos && todos.length ? `${done}/${todos.length}` : undefined}
      />
      {!todos || todos.length === 0 ? (
        <EmptyState icon={ListChecks} title={t("contextPanel.noTodos")} />
      ) : (
        <TodoList todos={todos} variant="panel" />
      )}
    </div>
  )
}

function FilesSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [query, setQuery] = useState("")
  const q = query.trim()
  return (
    <div className="flex h-full min-h-full flex-col">
      {!workspacePath ? (
        <EmptyState icon={FolderOpen} title={t("contextPanel.notConnectedTreeMsg")} />
      ) : (
        <>
          <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg bg-codezal-sidebar px-2.5 py-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-medium text-codezal-text">
                {t("contextPanel.workspaceFolder")}
              </div>
              <div className="truncate font-mono text-[11px] text-codezal-mute" title={workspacePath}>
                {workspacePath}
              </div>
            </div>
          </div>
          <div className="relative mb-2 shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-codezal-mute" />
            <label htmlFor="context-files-filter" className="sr-only">
              {t("contextPanel.filterFiles")}
            </label>
            <input
              id="context-files-filter"
              name="context-files-filter"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault()
                  setQuery("")
                }
              }}
              placeholder={t("contextPanel.filterFiles")}
              spellCheck={false}
              className="w-full rounded-md border border-codezal bg-codezal-input py-1.5 pl-7 pr-7 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-codezal-accent/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title={tStaticCtx("common.cancel")}
                aria-label={tStaticCtx("common.cancel")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-codezal-mute hover:text-codezal-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {q ? (
            <FileSearchResults root={workspacePath} query={q} />
          ) : (
            <FileTree root={workspacePath} />
          )}
        </>
      )}
    </div>
  )
}

function FileSearchResults({ root, query }: { root: string; query: string }) {
  const t = useT()
  const openFile = useSessionsStore((s) => s.openFile)
  const [all, setAll] = useState<DirEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAll(null)
    listDirShallow(root)
      .then((es) => {
        if (alive) setAll(es)
      })
      .catch(() => {
        if (alive) setAll([])
      })
    return () => {
      alive = false
    }
  }, [root])

  const matches = useMemo(() => {
    if (!all) return null
    const ql = query.toLowerCase()
    return all
      .filter(
        (e) =>
          !e.isDir &&
          (e.name.toLowerCase().includes(ql) || e.rel.toLowerCase().includes(ql)),
      )
      .slice(0, 200)
  }, [all, query])

  if (matches === null) {
    return <div className="px-2 py-1 text-sm text-codezal-mute">…</div>
  }
  if (matches.length === 0) {
    return (
      <div className="px-2 py-1 text-sm text-codezal-mute">
        {t("contextPanel.filterNoMatch")}
      </div>
    )
  }

  return (
    <ul className="flex flex-col text-sm text-codezal-text">
      {matches.map((e) => {
        const dir = e.rel.includes("/") ? e.rel.slice(0, e.rel.lastIndexOf("/")) : ""
        return (
          <li key={e.path}>
            <button
              type="button"
              onPointerDown={(ev) => startInternalDrag(ev, { kind: "file", payload: e.path, label: e.name })}
              onClick={() => {
                if (wasDragging()) return
                openFile(e.path)
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
              title={e.path}
            >
              <FileTypeIcon name={e.name} />
              <span className="truncate">{e.name}</span>
              {dir && (
                <span className="ml-auto shrink-0 max-w-[55%] truncate pl-2 text-sm text-codezal-mute">
                  {dir}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function FileTree({ root }: { root: string }) {
  const t = useT()
  const openFile = useSessionsStore((s) => s.openFile)
  const [editors, setEditors] = useState<EditorId[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null)
  const [renameT, setRenameT] = useState<MenuTarget | null>(null)
  const [createT, setCreateT] = useState<{ dir: string; kind: "file" | "dir" } | null>(null)
  const [deleteT, setDeleteT] = useState<MenuTarget | null>(null)

  useEffect(() => {
    let unwatch: (() => void) | undefined
    let alive = true
    watchWorkspace(root, (event) => {
      invalidateFromFileEvent(event, {
        normalize: normalizeFsPath,
        invalidate: invalidateFileContent,
        isOpen: () => false,
        reload: () => {},
        isDirLoaded: dirHasSubscribers,
        refreshDir: emitDirRefresh,
      })
    })
      .then((fn) => {
        if (alive) unwatch = fn
        else fn()
      })
      .catch(() => {
      })
    return () => {
      alive = false
      unwatch?.()
    }
  }, [root])

  useEffect(() => {
    detectEditors().then(setEditors)
  }, [])

  const openMenu = useCallback((e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }, [])

  const [clipState, setClipState] = useState(() => getFileClipboard())
  useEffect(() => subscribeFileClipboard(() => setClipState(getFileClipboard())), [])

  function refreshDir(dir: string) {
    emitDirRefresh(normalizeFsPath(dir))
  }

  async function doPaste(targetDir: string) {
    if (!getFileClipboard()) {
      toast.info(t("contextPanel.ctxPasteEmpty"))
      return
    }
    try {
      const dst = await applyFileClipboardPaste(targetDir)
      refreshDir(targetDir)
      emitExpand(targetDir)
      const srcDir = parentDir(clipState?.path ?? "")
      if (srcDir) refreshDir(srcDir)
      void dst
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  function doCopy(text: string) {
    void navigator.clipboard.writeText(text).catch(() => {})
  }

  async function submitRename(name: string) {
    const target = renameT
    setRenameT(null)
    if (!target) return
    if (!validName(name)) return toast.error(t("contextPanel.ctxInvalidName"))
    const dir = parentDir(target.path)
    const dest = joinFsPath(dir, name)
    if (dest === target.path) return
    try {
      if (await exists(dest)) return toast.error(t("contextPanel.ctxExists"))
      await rename(target.path, dest)
      invalidateFileContent(normalizeFsPath(target.path))
      refreshDir(dir)
      const st = useSessionsStore.getState()
      for (const f of [...(st.active?.openFiles ?? [])]) {
        if (isUnderOrEqual(f, target.path)) {
          st.closeFile(f)
          st.openFile(dest + f.slice(target.path.length))
        }
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function submitCreate(name: string) {
    const ct = createT
    setCreateT(null)
    if (!ct) return
    if (!validName(name)) return toast.error(t("contextPanel.ctxInvalidName"))
    const dest = joinFsPath(ct.dir, name)
    try {
      if (await exists(dest)) return toast.error(t("contextPanel.ctxExists"))
      if (ct.kind === "dir") await mkdir(dest, { recursive: true })
      else await writeTextFileSafe(dest, "")
      refreshDir(ct.dir)
      emitExpand(ct.dir)
      if (ct.kind === "file") openFile(dest)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function confirmDelete() {
    const target = deleteT
    setDeleteT(null)
    if (!target) return
    const dir = parentDir(target.path)
    try {
      await remove(target.path, { recursive: target.isDir })
      invalidateFileContent(normalizeFsPath(target.path))
      refreshDir(dir)
      const st = useSessionsStore.getState()
      for (const f of [...(st.active?.openFiles ?? [])]) {
        if (isUnderOrEqual(f, target.path)) st.closeFile(f)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  function buildItems(target: MenuTarget): CtxMenuItem[] {
    const items: CtxMenuItem[] = []
    if (!target.isDir) {
      items.push({ kind: "item", label: t("common.open"), icon: <Eye className="h-4 w-4" />, onClick: () => openFile(target.path) })
    }
    for (const id of editors) {
      items.push({
        kind: "item",
        label: t("contextPanel.ctxOpenEditor", { editor: EDITOR_LABELS[id] }),
        icon: <ExternalLink className="h-4 w-4" />,
        onClick: () => void openInEditor(id, target.path).catch((e) => toast.error(errorMessage(e))),
      })
    }
    items.push({
      kind: "item",
      label: isMacOS() ? t("contextPanel.ctxRevealFinder") : t("contextPanel.ctxRevealExplorer"),
      icon: <FolderOpen className="h-4 w-4" />,
      onClick: () => void revealItemInDir(target.path).catch((e) => toast.error(errorMessage(e))),
    })
    if (!target.isDir) {
      items.push({
        kind: "item",
        label: t("contextPanel.ctxAddToChat"),
        icon: <MessageSquarePlus className="h-4 w-4" />,
        onClick: () => {
          if (!insertToFocusedComposer(`@${relTo(root, target.path)} `)) {
            toast.info(t("contextPanel.ctxNoComposer"))
          }
        },
      })
    }
    items.push({ kind: "sep" })
    items.push({
      kind: "item",
      label: t("contextPanel.ctxCut"),
      icon: <Scissors className="h-4 w-4" />,
      onClick: () => setFileClipboard({ path: target.path, name: target.name, isDir: target.isDir, mode: "cut" }),
    })
    items.push({
      kind: "item",
      label: t("contextPanel.ctxCopy"),
      icon: <ClipboardCopy className="h-4 w-4" />,
      onClick: () => setFileClipboard({ path: target.path, name: target.name, isDir: target.isDir, mode: "copy" }),
    })
    items.push({
      kind: "item",
      label: t("contextPanel.ctxPaste"),
      icon: <ClipboardPaste className="h-4 w-4" />,
      disabled: !clipState,
      onClick: () => void doPaste(target.isDir ? target.path : parentDir(target.path)),
    })
    items.push({ kind: "sep" })
    items.push({ kind: "item", label: t("contextPanel.ctxCopyPath"), icon: <Copy className="h-4 w-4" />, onClick: () => doCopy(target.path) })
    items.push({ kind: "item", label: t("contextPanel.ctxCopyRelPath"), icon: <Copy className="h-4 w-4" />, onClick: () => doCopy(relTo(root, target.path)) })
    items.push({ kind: "sep" })
    const baseDir = target.isDir ? target.path : parentDir(target.path)
    items.push({ kind: "item", label: t("contextPanel.ctxNewFile"), icon: <Plus className="h-4 w-4" />, onClick: () => setCreateT({ dir: baseDir, kind: "file" }) })
    items.push({ kind: "item", label: t("contextPanel.ctxNewFolder"), icon: <FolderPlus className="h-4 w-4" />, onClick: () => setCreateT({ dir: baseDir, kind: "dir" }) })
    items.push({ kind: "item", label: t("contextPanel.ctxRename"), icon: <Pencil className="h-4 w-4" />, onClick: () => setRenameT(target) })
    items.push({ kind: "item", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" />, onClick: () => setDeleteT(target) })
    return items
  }

  function buildRootItems(): CtxMenuItem[] {
    return [
      { kind: "item", label: t("contextPanel.ctxNewFile"), icon: <Plus className="h-4 w-4" />, onClick: () => setCreateT({ dir: root, kind: "file" }) },
      { kind: "item", label: t("contextPanel.ctxNewFolder"), icon: <FolderPlus className="h-4 w-4" />, onClick: () => setCreateT({ dir: root, kind: "dir" }) },
      { kind: "sep" },
      {
        kind: "item",
        label: t("contextPanel.ctxPaste"),
        icon: <ClipboardPaste className="h-4 w-4" />,
        disabled: !clipState,
        onClick: () => void doPaste(root),
      },
      { kind: "sep" },
      {
        kind: "item",
        label: isMacOS() ? t("contextPanel.ctxRevealFinder") : t("contextPanel.ctxRevealExplorer"),
        icon: <FolderOpen className="h-4 w-4" />,
        onClick: () => void revealItemInDir(root).catch((e) => toast.error(errorMessage(e))),
      },
    ]
  }

  const openRootMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { path: root, name: "", isDir: true } })
  }, [root])

  const menuCtxValue = useMemo<FileTreeMenuValue>(
    () => ({ open: openMenu, activePath: menu?.target.path ?? null }),
    [openMenu, menu?.target.path],
  )

  return (
    <FileTreeMenuCtx.Provider value={menuCtxValue}>
      <div
        className="flex-1 select-none text-sm text-codezal-text"
        onContextMenu={openRootMenu}
      >
        <TreeLevel path={root} depth={0} startExpanded />
      </div>
      {menu && (
        <EditorContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.target.name === "" ? buildRootItems() : buildItems(menu.target)}
          onClose={() => setMenu(null)}
        />
      )}
      <PromptDialog
        key={renameT ? `rn:${renameT.path}` : "rn"}
        open={renameT !== null}
        title={t("contextPanel.ctxRename")}
        initialValue={renameT?.name ?? ""}
        placeholder={t("contextPanel.ctxRenamePlaceholder")}
        confirmLabel={t("common.save")}
        onConfirm={(v) => void submitRename(v)}
        onCancel={() => setRenameT(null)}
      />
      <PromptDialog
        key={createT ? `cr:${createT.kind}:${createT.dir}` : "cr"}
        open={createT !== null}
        title={createT?.kind === "dir" ? t("contextPanel.ctxNewFolder") : t("contextPanel.ctxNewFile")}
        placeholder={createT?.kind === "dir" ? t("contextPanel.ctxNewFolderPlaceholder") : t("contextPanel.ctxNewFilePlaceholder")}
        confirmLabel={t("contextPanel.ctxCreate")}
        onConfirm={(v) => void submitCreate(v)}
        onCancel={() => setCreateT(null)}
      />
      <ConfirmDialog
        open={deleteT !== null}
        title={`${t("common.delete")}: ${deleteT?.name ?? ""}`}
        message={t("contextPanel.ctxDeleteMsg")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteT(null)}
      />
    </FileTreeMenuCtx.Provider>
  )
}

function TreeLevel({
  path,
  depth,
  startExpanded,
}: {
  path: string
  depth: number
  startExpanded?: boolean
}) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!startExpanded && entries !== null) return
    readWorkspaceDir(path)
      .then((es) => {
        if (alive) setEntries(es)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    let alive = true
    const off = subscribeDirRefresh(normalizeFsPath(path), () => {
      readWorkspaceDir(path)
        .then((es) => {
          if (alive) setEntries(es)
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e))
        })
    })
    return () => {
      alive = false
      off()
    }
  }, [path])

  if (error) {
    return (
      <div className="px-2 py-1 text-sm text-destructive">{error}</div>
    )
  }
  if (entries === null) {
    return <div className="px-2 py-1 text-sm text-codezal-mute">…</div>
  }
  if (entries.length === 0) {
    return <div className="px-2 py-1 text-sm text-codezal-mute">{tStaticCtx("contextPanel.treeEmpty")}</div>
  }

  const orderedEntries = [
    ...entries.filter((entry) => !entry.name.startsWith(".")),
    ...entries.filter((entry) => entry.name.startsWith(".")),
  ]

  return (
    <ul className="flex flex-col">
      {orderedEntries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={depth} />
      ))}
    </ul>
  )
}

function TreeNode({ entry, depth }: { entry: FsEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const openFile = useSessionsStore((s) => s.openFile)
  const activeFile = useSessionsStore((s) => s.active?.activeFile ?? null)
  const isActive = !entry.isDir && activeFile === entry.path
  const menuCtx = useContext(FileTreeMenuCtx)
  const isCtxActive = menuCtx?.activePath === entry.path
  useEffect(() => {
    if (!entry.isDir) return
    return subscribeExpand(entry.path, () => setOpen(true))
  }, [entry.isDir, entry.path])
  const pad = { paddingLeft: `${depth * 10 + 4}px` }

  if (!entry.isDir) {
    return (
      <li>
        <button
          type="button"
          onPointerDown={(e) => startInternalDrag(e, { kind: "file", payload: entry.path, label: entry.name })}
          onClick={() => {
            if (wasDragging()) return
            openFile(entry.path, { preview: true })
          }}
          onDoubleClick={() => openFile(entry.path)}
          onContextMenu={(e) => menuCtx?.open(e, { path: entry.path, name: entry.name, isDir: false })}
          style={pad}
          className={cn(
            "group flex w-full items-center gap-1 truncate rounded-md px-2 py-[3px] text-left transition-colors focus-visible:ring-2 focus-visible:ring-codezal-accent/40",
            isActive
              ? "bg-codezal-accent/15 text-codezal-text"
              : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
            isCtxActive && "ring-1 ring-inset ring-codezal-accent/60",
          )}
        >
          <span className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100" aria-hidden>
            <FileTypeIcon name={entry.name} />
          </span>
          <span className="truncate">{entry.name}</span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onPointerDown={(e) => startInternalDrag(e, { kind: "file", payload: entry.path, label: entry.name })}
        onClick={() => {
          if (wasDragging()) return
          setOpen((v) => !v)
        }}
        onContextMenu={(e) => menuCtx?.open(e, { path: entry.path, name: entry.name, isDir: true })}
        style={pad}
        className={cn(
          "group flex w-full items-center gap-1 truncate rounded-md px-2 py-[3px] text-left text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text focus-visible:ring-2 focus-visible:ring-codezal-accent/40",
          isCtxActive && "ring-1 ring-inset ring-codezal-accent/60",
        )}
      >
        <ChevronRight
          className={cn(
            "h-2.5 w-2.5 shrink-0 text-codezal-mute transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100" aria-hidden>
          <FolderTypeIcon name={entry.name} open={open} />
        </span>
        <span className="truncate">{entry.name}</span>
      </button>
      {open && <TreeLevel path={entry.path} depth={depth + 1} />}
    </li>
  )
}

function AgentsSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [agents, setAgents] = useState<AgentDef[] | null>(null)
  const openFile = useSessionsStore((s) => s.openFile)

  // Live agent cards for the active session — spawn_agent runs surface here
  // (instead of inline in the chat). Patches to the message parts update them
  // in place. messages ref changes on each patch, so the memo stays fresh.
  const messages = useSessionsStore((s) => s.active?.messages)
  const runningCards = useMemo(() => {
    const out: AgentCardPart[] = []
    for (const m of messages ?? []) {
      for (const p of m.parts ?? []) {
        if (p.type === "agent-card") out.push(p)
      }
    }
    return out
  }, [messages])

  const hasCompletedCards = runningCards.some(
    (c) => c.status === "done" || c.status === "aborted" || c.status === "error",
  )
  const [dismissTick, setDismissTick] = useState(0)
  useEffect(() => {
    if (!hasCompletedCards) return
    const id = setInterval(() => setDismissTick((t) => t + 1), 1_000)
    return () => clearInterval(id)
  }, [hasCompletedCards])

  const visibleCards = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return runningCards.filter((c) => {
      if (c.status !== "done" && c.status !== "aborted" && c.status !== "error") return true
      if (!c.finishedAt) return false
      return now - c.finishedAt < 10_000
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCards, dismissTick])

  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgents(null)
    Promise.all([readWorkspaceAgents(workspacePath), readUserAgents()])
      .then(([p, u]) => {
        if (alive) setAgents([...p, ...u])
      })
      .catch(() => {
        if (alive) setAgents([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath])

  return (
    <div className="flex flex-col gap-3">
      {visibleCards.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            label={
              visibleCards.some(
                (c) =>
                  c.status === "running" ||
                  c.status === "pending" ||
                  c.status === "waiting-approval",
              )
                ? t("contextPanel.runningHeading")
                : t("contextPanel.doneHeading")
            }
            right={String(visibleCards.length)}
          />
          {visibleCards.map((c) => (
            <AgentCard key={c.workerId} part={c} compact />
          ))}
        </div>
      )}
      <div>
      {!agents ? (
        <div className="px-1 py-6 text-center text-sm text-codezal-mute">…</div>
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} title={t("contextPanel.noAgents")}>
          <code className="text-codezal-dim">.codezal/agents/&lt;name&gt;.md</code>{t("contextPanel.agentEmptyHintWorkspaceOr")}
          <code className="text-codezal-dim">~/.codezal/agents/&lt;name&gt;.md</code>{t("contextPanel.agentEmptyHintAdd")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-0.5">
          {agents.map((a) => (
            <button
              key={a.path}
              type="button"
              onClick={() => openFile(a.path)}
              className="flex flex-col gap-0.5 truncate rounded-md px-2 py-[3px] text-left hover:bg-codezal-panel-2"
              title={a.path}
            >
              <span className="flex items-center gap-2">
                <Identicon seed={a.name} size={16} className="shrink-0 rounded" />
                <span className="truncate text-sm text-codezal-text">{a.name}</span>
                <span className="ml-auto shrink-0 text-sm text-codezal-mute">
                  {a.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
                </span>
              </span>
              {a.description && (
                <span className="truncate pl-5 text-sm text-codezal-dim">
                  {a.description}
                </span>
              )}
              {a.model && (
                <span className="truncate pl-5 font-mono text-sm text-codezal-mute">
                  · {a.model}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}

function SkillsSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const openFile = useSessionsStore((s) => s.openFile)
  const disabled = useSettingsStore((s) => s.settings.disabledSkills ?? EMPTY_DISABLED)
  const disabledSet = new Set(disabled)

  const reload = useCallback(() => {
    let alive = true
    setSkills(null)
    // listAllSkills: workspace + user (.codezal & .agents) + plugin, dedup'lu.
    listAllSkills(workspacePath)
      .then((all) => {
        if (alive) setSkills(all)
      })
      .catch(() => {
        if (alive) setSkills([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const cancel = reload()
    const onChange = () => reload()
    window.addEventListener("codezal:skills-changed", onChange)
    return () => {
      cancel()
      window.removeEventListener("codezal:skills-changed", onChange)
    }
  }, [reload])

  return (
    <div>
      <SectionHead label={t("contextPanel.skillsHeading")} right={String(skills?.length ?? 0)} />
      {!skills ? (
        <div className="px-1 py-6 text-center text-sm text-codezal-mute">…</div>
      ) : skills.length === 0 ? (
        <EmptyState icon={Sparkles} title={t("contextPanel.noSkills2")}>
          <code className="text-codezal-dim">.codezal/skills/&lt;name&gt;/SKILL.md</code>{t("contextPanel.skillEmptyHintWorkspaceOr")}
          <code className="text-codezal-dim">~/.codezal/skills/&lt;name&gt;/SKILL.md</code>{t("contextPanel.skillEmptyHintAdd")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-0.5">
          {skills.map((s) => (
            <button
              key={s.path}
              type="button"
              onClick={() => openFile(s.path)}
              className={cn(
                "flex flex-col gap-0.5 truncate rounded-md px-2 py-[3px] text-left hover:bg-codezal-panel-2",
                disabledSet.has(s.name) && "opacity-40",
              )}
              title={s.path}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-codezal-accent" />
                <span className="truncate text-sm text-codezal-text">{s.name}</span>
                <span className="ml-auto shrink-0 text-sm text-codezal-mute">
                  {s.scope === "project"
                    ? t("contextPanel.scopeProject")
                    : s.scope === "global"
                      ? t("contextPanel.scopeGlobal")
                      : s.scope}
                </span>
              </span>
              {s.description && (
                <span className="truncate pl-5 text-sm text-codezal-dim">
                  {s.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryEditor({
  path,
  name,
  onClose,
  onSaved,
}: {
  path: string
  name: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [content, setContent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    readTextFileSafe(path)
      .then((c) => {
        if (alive) setContent(c)
      })
      .catch(() => {
        if (alive) setContent("")
      })
    return () => {
      alive = false
    }
  }, [path])

  async function save() {
    if (content == null) return
    setSaving(true)
    setErr(null)
    try {
      const dir = path.replace(/\\/g, "/").replace(/\/[^/]*$/, "")
      if (dir && dir !== path) await mkdir(dir, { recursive: true }).catch(() => {})
      await writeTextFileSafe(path, content)
      invalidateMemoryCache(path)
      invalidateFileContent(normalizeFsPath(path))
      onSaved()
    } catch (e) {
      setErr(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          title={t("common.cancel")}
          className="shrink-0 rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="flex-1 truncate text-sm text-codezal-text" title={path}>
          {name}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || content == null}
          className="flex shrink-0 items-center gap-1 rounded bg-codezal-accent px-2 py-1 text-sm text-white disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" /> {t("common.save")}
        </button>
      </div>
      {err && <div className="mb-1 text-sm text-red-400">{err}</div>}
      {content == null ? (
        <div className="px-1 py-3 text-sm text-codezal-mute">…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-[320px] flex-1 resize-none rounded border border-codezal bg-codezal-panel-2 p-2 font-mono text-sm leading-relaxed text-codezal-text focus:outline-none"
        />
      )}
    </div>
  )
}

function MemorySection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const [reloadKey, setReloadKey] = useState(0)
  const files = useMemoryFiles(workspacePath, "memory", reloadKey)
  const openFile = useSessionsStore((s) => s.openFile)
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null)

  async function createMemory(scope: "project" | "global") {
    const path = await memoryTargetPath(scope, workspacePath)
    if (!path) return
    setEditing({ path, name: scope === "project" ? ".codezal/memory.md" : "~/.codezal/MEMORY.md" })
  }

  if (editing) {
    return (
      <MemoryEditor
        path={editing.path}
        name={editing.name}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setReloadKey((k) => k + 1)
        }}
      />
    )
  }

  return (
    <div>
      <SectionHead
        label={t("contextPanel.memoryHeading")}
        right={String(files?.length ?? 0)}
      />
      <div className="mb-1.5 flex flex-wrap gap-1">
        {workspacePath && (
          <button
            type="button"
            onClick={() => void createMemory("project")}
            className="flex items-center gap-1 rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim hover:text-codezal-text"
          >
            <Plus className="h-3.5 w-3.5" /> {t("contextPanel.memoryCreateProject")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void createMemory("global")}
          className="flex items-center gap-1 rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim hover:text-codezal-text"
        >
          <Plus className="h-3.5 w-3.5" /> {t("contextPanel.memoryCreateGlobal")}
        </button>
      </div>
      {!files ? (
        <div className="px-1 py-6 text-center text-sm text-codezal-mute">…</div>
      ) : files.length === 0 ? (
        <EmptyState icon={FileText} title={t("contextPanel.noMemoryFiles")}>
          {t("contextPanel.memoryEmptyHintPre")}
          <code className="text-codezal-dim">CODEZAL.md</code> {t("common.or")}{" "}
          <code className="text-codezal-dim">CLAUDE.md</code>
          {t("contextPanel.memoryEmptyHintPost")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-0.5">
          {files.map((f) => (
            <div
              key={f.path}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-codezal-text hover:bg-codezal-panel-2"
              title={f.path}
            >
              <FileText className="h-4 w-4 shrink-0 text-codezal-accent" />
              <button
                type="button"
                onClick={() => setEditing({ path: f.path, name: f.name })}
                className="flex-1 truncate text-left"
              >
                {f.name}
              </button>
              <span className="shrink-0 text-sm text-codezal-mute">
                {f.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
              </span>
              <span className="shrink-0 text-sm text-codezal-mute">{Math.ceil(f.bytes / 1024)}K</span>
              <button
                type="button"
                onClick={() => setEditing({ path: f.path, name: f.name })}
                title={t("common.edit")}
                className="shrink-0 p-0.5 text-codezal-mute opacity-0 hover:text-codezal-text group-hover:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => openFile(f.path)}
                title={t("contextPanel.memoryOpenExternal")}
                className="shrink-0 p-0.5 text-codezal-mute opacity-0 hover:text-codezal-text group-hover:opacity-100"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RulesSection({ workspacePath }: { workspacePath?: string }) {
  const t = useT()
  const files = useMemoryFiles(workspacePath, "rules")
  const openFile = useSessionsStore((s) => s.openFile)

  return (
    <div>
      <SectionHead label={t("contextPanel.rulesHeading")} right={String(files?.length ?? 0)} />
      {!files ? (
        <div className="px-1 py-6 text-center text-sm text-codezal-mute">…</div>
      ) : files.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("contextPanel.noRulesFiles")}>
          <code className="text-codezal-dim">.codezal/rules/*.md</code> {t("contextPanel.rulesWorkspace")} {t("common.or")}{" "}
          <code className="text-codezal-dim">~/.codezal/rules/*.md</code> {t("contextPanel.rulesGlobal")}
          {t("contextPanel.rulesEmptyHintPost")}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-1">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => openFile(f.path)}
              className="flex items-center gap-2 truncate rounded-md px-2 py-[3px] text-left text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
              title={f.path}
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-codezal-accent" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-sm text-codezal-mute">
                {f.scope === "project" ? t("contextPanel.scopeProject") : t("contextPanel.scopeGlobal")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useMemoryFiles(
  workspacePath: string | undefined,
  mode: "memory" | "rules",
  reloadKey = 0,
): MemoryFile[] | null {
  const [files, setFiles] = useState<MemoryFile[] | null>(null)

  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiles(null)
    Promise.all([
      workspacePath ? readProjectMemory(workspacePath) : Promise.resolve([]),
      readUserMemory(),
    ])
      .then(([p, u]) => {
        if (!alive) return
        const all = [...p, ...u]
        const filtered = all.filter((f) => {
          const isRule =
            f.name.includes("/rules/") ||
            f.name.startsWith("rules/") ||
            f.name.toLowerCase() === "rules.md"
          return mode === "rules" ? isRule : !isRule
        })
        setFiles(filtered)
      })
      .catch(() => {
        if (alive) setFiles([])
      })
    return () => {
      alive = false
    }
  }, [workspacePath, mode, reloadKey])

  return files
}
