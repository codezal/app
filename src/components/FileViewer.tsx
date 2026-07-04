// kopyala.
import { useEffect, useRef, useState, useCallback } from "react"
import { type UnwatchFn } from "@tauri-apps/plugin-fs"
import { readFileSafe, readTextFileSafe, writeTextFileSafe } from "@/lib/fs-safe"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { isImage, mimeForImage } from "@/lib/file-type"
import { detectEditors, openInEditor, EDITOR_LABELS, type EditorId } from "@/lib/editors"
import { watchFile } from "@/lib/file-watcher"
import { invalidateFromFileEvent } from "@/lib/file-invalidate"
import { fmtKbd } from "@/lib/platform"
import {
  getFileContent,
  setFileContent,
  invalidateFileContent,
  normalizeFsPath,
} from "@/lib/file-content-cache"
import { setDirty as storeSetDirty, isDirty } from "@/lib/editor-dirty"
import { getDraft, clearDraft } from "@/lib/editor-drafts"
import { markSelfWrite, consumeSelfWrite } from "@/lib/editor-save"
import { CodeEditor, type CodeEditorHandle, type InlineSelection } from "./CodeEditor"
import { InlineEditBar } from "./InlineEditBar"
import { ConfirmDialog } from "./ConfirmDialog"
import { toast } from "@/store/toast"
import { useSessionsStore } from "@/store/sessions"
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  FolderOpen,
  MessageSquare,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  X,
} from "@/lib/icons"
import { EditorContextMenu } from "./EditorContextMenu"
import { insertToFocusedComposer } from "@/lib/composer-drop"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import "@/styles/highlight.css"
import { errorMessage } from "@/lib/errors"

const CAP = 500_000

function getPreviewKind(path: string): "image" | "pdf" | null {
  const clean = path.split(/[?#]/)[0] ?? path
  if (isImage(clean)) return "image"
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase()
  return ext === "pdf" ? "pdf" : null
}

type Props = {
  path: string
  reloadSignal?: number
}

export function FileViewer({ path, reloadSignal }: Props) {
  const t = useT()
  const workspaceRoot = useSessionsStore((s) => s.active?.workspacePath ?? null)
  const openFiles = useSessionsStore((s) => s.active?.openFiles ?? [])
  const closeAllFiles = useSessionsStore((s) => s.closeAllFiles)
  const [confirmCloseAll, setConfirmCloseAll] = useState(false)
  const requestCloseAll = () => {
    if (openFiles.some((p) => isDirty(p))) setConfirmCloseAll(true)
    else closeAllFiles()
  }

  const previewKind = getPreviewKind(path)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const reloadSignalFirst = useRef(true)
  useEffect(() => {
    if (reloadSignal === undefined) return
    if (reloadSignalFirst.current) {
      reloadSignalFirst.current = false
      return
    }
    setReloadTick((tick) => tick + 1)
  }, [reloadSignal])

  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [diskChanged, setDiskChanged] = useState(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [editors, setEditors] = useState<EditorId[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  const editorRef = useRef<CodeEditorHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    detectEditors().then(setEditors)
  }, [])

  useEffect(() => {
    if (!previewKind) return
    let alive = true
    let url = ""
    readFileSafe(path)
      .then((bytes) => {
        if (!alive) return
        const mime = previewKind === "pdf" ? "application/pdf" : mimeForImage(path)
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
        setBlobUrl(url)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e))
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, previewKind])

  useEffect(() => {
    if (previewKind) return
    let alive = true
    const key = normalizeFsPath(path)
    const apply = (txt: string) => {
      if (txt.length > CAP) {
        setContent(txt.slice(0, CAP))
        setTruncated(true)
        setError(tStatic("fileViewer.largeFileTruncated", { total: txt.length }))
      } else {
        setContent(txt)
        setTruncated(false)
        setError(null)
      }
    }
    const cached = getFileContent(key)
    if (cached !== undefined) {
      apply(cached)
      return () => {
        alive = false
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(null)
    setError(null)
    readTextFileSafe(path)
      .then((txt) => {
        if (!alive) return
        setFileContent(key, txt)
        apply(txt)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [path, reloadTick, previewKind])

  useEffect(() => {
    if (previewKind) return
    let unwatch: UnwatchFn | undefined
    let alive = true
    const open = normalizeFsPath(path)
    watchFile(path, (event) => {
      invalidateFromFileEvent(event, {
        normalize: normalizeFsPath,
        invalidate: (p) => {
          if (p === open && consumeSelfWrite(open)) return
          invalidateFileContent(p)
        },
        isOpen: (p) => p === open,
        reload: () => {
          if (consumeSelfWrite(open)) return // kendi save'imiz
          if (dirtyRef.current) {
            setDiskChanged(true) // dirty → ezme, sor
            return
          }
          setReloadTick((n) => n + 1)
        },
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
  }, [path, previewKind])

  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false)
    }
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDoc)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDoc)
    }
  }, [menuOpen])

  const prevPath = useRef(path)
  useEffect(() => {
    if (prevPath.current === path) return
    prevPath.current = path
    dirtyRef.current = false
    setDirty(false)
    setDiskChanged(false)
    setMenuOpen(false)
  }, [path])

  const onDirty = useCallback(
    (d: boolean) => {
      dirtyRef.current = d
      setDirty(d)
      storeSetDirty(path, d)
    },
    [path],
  )

  const canEdit = !truncated && !error && content !== null

  const [inlineEdit, setInlineEdit] = useState<{
    sel: InlineSelection
    rect: { top: number; bottom: number; left: number } | null
    provider: string
    model: string
  } | null>(null)

  const openInlineEdit = useCallback(
    (cap?: { sel: InlineSelection | null; rect: { top: number; bottom: number; left: number } | null }) => {
      const ed = editorRef.current
      if (!ed) return
      const sel = cap?.sel ?? ed.getSelection()
      if (!sel) {
        toast.info(tStatic("inlineEdit.needSelection"))
        return
      }
      const active = useSessionsStore.getState().active
      if (!active) return
      setInlineEdit({
        sel,
        rect: cap?.rect ?? ed.getSelectionRect(),
        provider: active.provider,
        model: active.model,
      })
    },
    [],
  )

  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    sel: InlineSelection | null
    rect: { top: number; bottom: number; left: number } | null
    range: { from: number; to: number } | null
  } | null>(null)

  function onEditorContextMenu(e: React.MouseEvent) {
    const ed = editorRef.current
    if (!ed) return
    e.preventDefault()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      sel: ed.getSelection(),
      rect: ed.getSelectionRect(),
      range: ed.getMainRange(),
    })
  }

  function fileRef(): string {
    const ws = workspaceRoot
    if (ws && path.startsWith(ws)) return path.slice(ws.length).replace(/^[/\\]/, "")
    return path
  }

  function snippet(sel: InlineSelection): string {
    const lang = path.split(".").pop() ?? ""
    const lines =
      sel.startLine === sel.endLine ? `L${sel.startLine}` : `L${sel.startLine}-${sel.endLine}`
    return `@${fileRef()} (${lines})\n\n\`\`\`${lang}\n${sel.text}\n\`\`\`\n`
  }

  function ctxAiEdit() {
    const m = ctxMenu
    if (m?.sel) openInlineEdit({ sel: m.sel, rect: m.rect })
  }

  function ctxSendToChat() {
    if (ctxMenu?.sel) insertToFocusedComposer(snippet(ctxMenu.sel))
  }

  function ctxNewSession() {
    const sel = ctxMenu?.sel
    if (!sel) return
    const active = useSessionsStore.getState().active
    if (!active) return
    useSessionsStore.getState().createDraft(active.provider, active.model, active.workspacePath)
    requestAnimationFrame(() => insertToFocusedComposer(snippet(sel)))
  }

  function ctxCopy() {
    if (ctxMenu?.sel) void navigator.clipboard.writeText(ctxMenu.sel.text).catch(() => {})
  }

  async function ctxCut() {
    const sel = ctxMenu?.sel
    if (!sel) return
    await navigator.clipboard.writeText(sel.text).catch(() => {})
    editorRef.current?.applyRange(sel.from, sel.to, "")
  }

  async function ctxPaste() {
    const range = ctxMenu?.range
    if (!range) return
    const text = await navigator.clipboard.readText().catch(() => "")
    if (text) editorRef.current?.applyRange(range.from, range.to, text)
  }

  function ctxSelectAll() {
    editorRef.current?.selectAll()
  }

  async function onSave() {
    if (!canEdit) return
    const text = editorRef.current?.getText() ?? getDraft(path)
    if (text === undefined) return
    try {
      markSelfWrite(path)
      await writeTextFileSafe(path, text)
      setFileContent(normalizeFsPath(path), text)
      setContent(text)
      if (editorRef.current) editorRef.current.markSaved()
      else {
        clearDraft(path)
        onDirty(false)
      }
      setDiskChanged(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function onReloadFromDisk() {
    try {
      const txt = await readTextFileSafe(path)
      const capped = txt.length > CAP ? txt.slice(0, CAP) : txt
      setFileContent(normalizeFsPath(path), txt)
      setContent(capped)
      setTruncated(txt.length > CAP)
      setError(txt.length > CAP ? tStatic("fileViewer.largeFileTruncated", { total: txt.length }) : null)
      if (editorRef.current) editorRef.current.replaceDoc(capped)
      else {
        clearDraft(path)
        onDirty(false)
      }
      setDiskChanged(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function onCopy() {
    const text = editorRef.current?.getText() ?? content
    if (text === null || text === undefined) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }

  async function openWith(cmd: EditorId) {
    setMenuOpen(false)
    try {
      await openInEditor(cmd, path)
    } catch (e) {
      console.error("open in editor failed:", e)
    }
  }

  async function onRevealInFinder() {
    setMenuOpen(false)
    try {
      await revealItemInDir(path)
    } catch (e) {
      console.error("reveal in dir failed:", e)
    }
  }

  if (previewKind) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-codezal px-4 py-2 text-sm text-codezal-mute">
          <span className="truncate text-codezal-text" title={path}>
            {path}
          </span>
          <div ref={menuRef} className="relative ml-auto shrink-0">
            <ToolbarButton
              title={t("fileViewer.openWith")}
              active={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <FolderOpen className="h-4 w-4" />
            </ToolbarButton>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden cz-menu py-1">
                {editors.length === 0 ? (
                  <div className="px-3 py-1.5 text-base text-codezal-mute">
                    {t("fileViewer.noEditors")}
                  </div>
                ) : (
                  editors.map((id) => (
                    <MenuItem key={id} onClick={() => openWith(id)}>
                      {t("fileViewer.openIn", { app: EDITOR_LABELS[id] })}
                    </MenuItem>
                  ))
                )}
                <div className="my-1 h-px bg-codezal-hair" />
                <MenuItem onClick={onRevealInFinder}>{t("fileViewer.showInFinder")}</MenuItem>
              </div>
            )}
          </div>
        </div>
        {error ? (
          <div className="m-4 shrink-0 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : !blobUrl ? (
          <div className="px-4 py-4 text-sm text-codezal-mute">{t("fileViewer.loading")}</div>
        ) : previewKind === "image" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-codezal-bg p-4">
            <img src={blobUrl} alt={path} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <iframe src={blobUrl} title={path} className="min-h-0 w-full flex-1 border-0 bg-white" />
        )}
      </div>
    )
  }

  const showEditor = content !== null

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {/* Header toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-codezal px-4 py-2 text-sm text-codezal-mute">
        <span className="truncate text-codezal-text" title={path}>
          {path}
        </span>
        {content !== null && (
          <span className="ml-auto shrink-0">
            {content.length} {t("fileViewer.charsLabel")}
          </span>
        )}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            content !== null ? "" : "ml-auto",
          )}
        >
          {!canEdit && content !== null && (
            <span
              title={t("fileViewer.readOnlyLarge")}
              className="flex h-[26px] items-center gap-1.5 rounded-md px-2 text-sm text-codezal-mute"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{t("fileViewer.readOnly")}</span>
            </span>
          )}

          {dirty && (
            <button
              type="button"
              onClick={onSave}
              title={t("fileViewer.save")}
              className="flex h-[26px] items-center gap-1.5 rounded-md border border-codezal-accent/50 px-2 text-sm font-medium text-codezal-accent transition-colors hover:bg-codezal-accent/10"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{t("fileViewer.save")}</span>
            </button>
          )}

          {showEditor && (
            <ToolbarButton
              title={t("common.search")}
              onClick={() => editorRef.current?.openSearch()}
            >
              <Search className="h-4 w-4" />
            </ToolbarButton>
          )}

          {/* Open-with menu */}
          <div ref={menuRef} className="relative">
            <ToolbarButton
              title={t("fileViewer.openWith")}
              active={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <FolderOpen className="h-4 w-4" />
            </ToolbarButton>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden cz-menu py-1">
                {editors.length === 0 ? (
                  <div className="px-3 py-1.5 text-base text-codezal-mute">
                    {t("fileViewer.noEditors")}
                  </div>
                ) : (
                  editors.map((id) => (
                    <MenuItem key={id} onClick={() => openWith(id)}>
                      {t("fileViewer.openIn", { app: EDITOR_LABELS[id] })}
                    </MenuItem>
                  ))
                )}
                <div className="my-1 h-px bg-codezal-hair" />
                <MenuItem onClick={onRevealInFinder}>{t("fileViewer.showInFinder")}</MenuItem>
              </div>
            )}
          </div>

          <ToolbarButton title={tStatic("messageList.copyBlockTitle")} onClick={onCopy}>
            {copied ? (
              <Check className="h-4 w-4 text-codezal-accent" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </ToolbarButton>

          <ToolbarButton title={t("common.close")} onClick={requestCloseAll}>
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      {diskChanged && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm text-codezal-text">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">{t("fileViewer.diskChangedTitle")}</span>
          <button
            type="button"
            onClick={onReloadFromDisk}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t("fileViewer.diskChangedReload")}
          </button>
          <button
            type="button"
            onClick={() => setDiskChanged(false)}
            className="rounded px-2 py-0.5 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            {t("fileViewer.diskChangedKeep")}
          </button>
        </div>
      )}

      {/* Body */}
      {error && (
        <div className="m-4 shrink-0 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {content === null && !error ? (
        <div className="px-4 py-4 text-sm text-codezal-mute">{t("fileViewer.loading")}</div>
      ) : content !== null ? (
        <CodeEditor
          key={path}
          ref={editorRef}
          path={path}
          initialText={getDraft(path) ?? content}
          baselineText={content}
          readOnly={!canEdit}
          workspaceRoot={workspaceRoot}
          onSave={onSave}
          onDirtyChange={onDirty}
          onInlineEdit={canEdit ? openInlineEdit : undefined}
          onContextMenu={canEdit ? onEditorContextMenu : undefined}
        />
      ) : null}
      {inlineEdit && (
        <InlineEditBar
          selection={inlineEdit.sel}
          rect={inlineEdit.rect}
          language={path.split(".").pop() ?? ""}
          providerId={inlineEdit.provider}
          modelId={inlineEdit.model}
          onAccept={(text) => {
            editorRef.current?.applyRange(inlineEdit.sel.from, inlineEdit.sel.to, text)
            setInlineEdit(null)
          }}
          onClose={() => setInlineEdit(null)}
        />
      )}
      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              kind: "item",
              label: tStatic("editorMenu.aiEdit"),
              shortcut: fmtKbd("⌘I"),
              icon: <Sparkles className="h-4 w-4" />,
              disabled: !ctxMenu.sel,
              onClick: ctxAiEdit,
            },
            {
              kind: "item",
              label: tStatic("editorMenu.sendToChat"),
              icon: <MessageSquare className="h-4 w-4" />,
              disabled: !ctxMenu.sel,
              onClick: ctxSendToChat,
            },
            {
              kind: "item",
              label: tStatic("editorMenu.newSession"),
              icon: <Plus className="h-4 w-4" />,
              disabled: !ctxMenu.sel,
              onClick: ctxNewSession,
            },
            { kind: "sep" },
            {
              kind: "item",
              label: tStatic("editorMenu.copy"),
              shortcut: fmtKbd("⌘C"),
              icon: <Copy className="h-4 w-4" />,
              disabled: !ctxMenu.sel,
              onClick: ctxCopy,
            },
            {
              kind: "item",
              label: tStatic("editorMenu.cut"),
              shortcut: fmtKbd("⌘X"),
              disabled: !ctxMenu.sel || !canEdit,
              onClick: ctxCut,
            },
            {
              kind: "item",
              label: tStatic("editorMenu.paste"),
              shortcut: fmtKbd("⌘V"),
              disabled: !canEdit,
              onClick: ctxPaste,
            },
            { kind: "sep" },
            {
              kind: "item",
              label: tStatic("editorMenu.selectAll"),
              shortcut: fmtKbd("⌘A"),
              onClick: ctxSelectAll,
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={confirmCloseAll}
        title={t("fileViewer.unsavedTitle")}
        message={t("fileViewer.unsavedMessage")}
        confirmLabel={t("fileViewer.unsavedConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          closeAllFiles()
          setConfirmCloseAll(false)
        }}
        onCancel={() => setConfirmCloseAll(false)}
      />
    </div>
  )
}

// ---- Toolbar / menu primitives ----

function ToolbarButton({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-[26px] w-[26px] items-center justify-center rounded text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-codezal-dim",
        active && "bg-codezal-panel-2 text-codezal-text",
      )}
    >
      {children}
    </button>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center px-3 py-1.5 text-left text-base text-codezal-text hover:bg-codezal-panel-2"
    >
      {children}
    </button>
  )
}
