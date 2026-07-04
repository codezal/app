import { useEffect, useImperativeHandle, useRef, type Ref, type MouseEvent as ReactMouseEvent } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import type { editor as MonacoNs, IDisposable } from "monaco-editor"
import { monaco, monacoLanguageFor, applyCurrentTheme, watchThemeChanges } from "@/lib/monaco/setup"
import { registerLspCodeActionProvider } from "@/lib/monaco/code-actions"
import { getFileScroll, setFileScroll } from "@/lib/file-scroll-cache"
import { setDraft, clearDraft } from "@/lib/editor-drafts"
import { findProjectRoot } from "@/lib/project-root"
import { lspEditSession, type LspEditHandle, type LspDiagnostic } from "@/lib/lsp"
import { useSessionsStore } from "@/store/sessions"

export type InlineSelection = {
  from: number
  to: number
  text: string
  prefix: string
  suffix: string
  startLine: number
  endLine: number
}

export type CodeEditorHandle = {
  getText: () => string
  replaceDoc: (text: string) => void
  // Kaydedildi: baseline = mevcut doc → dirty=false.
  markSaved: () => void
  openSearch: () => void
  getSelection: () => InlineSelection | null
  getSelectionRect: () => { top: number; bottom: number; left: number } | null
  applyRange: (from: number, to: number, text: string) => void
  getMainRange: () => { from: number; to: number } | null
  selectAll: () => void
}

type Props = {
  path: string
  initialText: string
  baselineText: string
  readOnly?: boolean
  workspaceRoot: string | null
  onSave: () => void
  onDirtyChange: (dirty: boolean) => void
  onInlineEdit?: () => void
  onContextMenu?: (e: ReactMouseEvent) => void
  ref?: Ref<CodeEditorHandle>
}

export function CodeEditor({
  path,
  initialText,
  baselineText,
  readOnly = false,
  workspaceRoot,
  onSave,
  onDirtyChange,
  onInlineEdit,
  onContextMenu,
  ref,
}: Props) {
  const editorRef = useRef<MonacoNs.IStandaloneCodeEditor | null>(null)
  const baselineRef = useRef(baselineText)
  const disposablesRef = useRef<IDisposable[]>([])

  const onSaveRef = useRef(onSave)
  const onDirtyRef = useRef(onDirtyChange)
  const onInlineEditRef = useRef(onInlineEdit)
  useEffect(() => {
    onSaveRef.current = onSave
    onDirtyRef.current = onDirtyChange
    onInlineEditRef.current = onInlineEdit
  })

  // dil sunucusu spawn etmeyelim).
  const sessionRef = useRef<LspEditHandle | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)
  const sessionStarted = useRef(false)
  const codeActionProviderRegistered = useRef(false)
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    applyCurrentTheme()
    watchThemeChanges()
  }, [])

  const handleMount: OnMount = (editor, m) => {
    editorRef.current = editor
    applyCurrentTheme()

    const pos = getFileScroll(path)
    if (pos) {
      editor.setScrollPosition({ scrollTop: pos.top, scrollLeft: pos.left })
    }
    const scrollDisp = editor.onDidScrollChange(() => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(() => {
        const ed = editorRef.current
        if (!ed) return
        setFileScroll(path, { top: ed.getScrollTop(), left: ed.getScrollLeft() })
      }, 150)
    })
    disposablesRef.current.push(scrollDisp)

    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      onSaveRef.current()
    })
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyI, () => {
      onInlineEditRef.current?.()
    })

    const model = editor.getModel()
    if (model) {
      const lang = monacoLanguageFor(path)
      if (lang !== "plaintext" && model.getLanguageId() !== lang) {
        m.editor.setModelLanguage(model, lang)
      }
      const changeDisp = model.onDidChangeContent(() => {
        const text = model.getValue()
        const dirty = text !== baselineRef.current
        onDirtyRef.current(dirty)
        if (dirty) {
          setDraft(path, text)
          const st = useSessionsStore.getState()
          if (st.active?.previewFile === path) st.pinPreviewFile()
        } else clearDraft(path)
        if (changeTimer.current) clearTimeout(changeTimer.current)
        changeTimer.current = setTimeout(() => {
          sessionRef.current?.change(text)
        }, 400)
      })
      disposablesRef.current.push(changeDisp)
    }

    onDirtyRef.current(initialText !== baselineRef.current)

    if (!readOnly && !sessionStarted.current) {
      sessionStarted.current = true
      void (async () => {
        const root = (await findProjectRoot(path)) ?? workspaceRoot
        const ed = editorRef.current
        if (!root || !ed) return
        const mdl = ed.getModel()
        if (!mdl) return
        const text = mdl.getValue()
        const res = await lspEditSession(root, path, text)
        if (!res.available) return
        sessionRef.current = res.data
        unlistenRef.current = await res.data.onDiagnostics((diags) => {
          const curEd = editorRef.current
          const curMdl = curEd?.getModel()
          if (!curMdl) return
          monaco.editor.setModelMarkers(curMdl, "lsp", toMonacoMarkers(curMdl, diags))
        })
        if (!codeActionProviderRegistered.current) {
          codeActionProviderRegistered.current = true
          const provider = registerLspCodeActionProvider(
            ["typescript", "javascript", "typescriptreact", "javascriptreact", "rust", "go", "python", "json", "html", "css"],
            () => sessionRef.current,
          )
          disposablesRef.current.push(provider)
        }
      })().catch(() => {
      })
    }
  }

  useEffect(() => {
    return () => {
      const ed = editorRef.current
      if (ed) {
        setFileScroll(path, { top: ed.getScrollTop(), left: ed.getScrollLeft() })
      }
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      if (changeTimer.current) clearTimeout(changeTimer.current)
      unlistenRef.current?.()
      void sessionRef.current?.dispose()
      unlistenRef.current = null
      sessionRef.current = null
      for (const d of disposablesRef.current) d.dispose()
      disposablesRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  useImperativeHandle(
    ref,
    (): CodeEditorHandle => ({
      getText: () => editorRef.current?.getModel()?.getValue() ?? baselineRef.current,
      replaceDoc: (text) => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!model) return
        model.setValue(text)
        baselineRef.current = text
        clearDraft(path)
        onDirtyRef.current(false)
      },
      markSaved: () => {
        const ed = editorRef.current
        baselineRef.current = ed?.getModel()?.getValue() ?? baselineRef.current
        clearDraft(path)
        onDirtyRef.current(false)
      },
      openSearch: () => {
        void editorRef.current?.getAction("actions.find")?.run()
      },
      getSelection: () => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!ed || !model) return null
        const sel = ed.getSelection()
        if (!sel || sel.isEmpty()) return null
        const from = model.getOffsetAt(sel.getStartPosition())
        const to = model.getOffsetAt(sel.getEndPosition())
        if (from === to) return null
        const text = model.getValueInRange(sel)
        const all = model.getValue()
        return {
          from,
          to,
          text,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
          prefix: all.slice(Math.max(0, from - 4000), from),
          suffix: all.slice(to, Math.min(all.length, to + 4000)),
        }
      },
      getSelectionRect: () => {
        const ed = editorRef.current
        if (!ed) return null
        const sel = ed.getSelection()
        if (!sel) return null
        const startPos = ed.getScrolledVisiblePosition(sel.getStartPosition())
        const endPos = ed.getScrolledVisiblePosition(sel.getEndPosition())
        if (!startPos) return null
        const dom = ed.getDomNode()
        if (!dom) return null
        const rect = dom.getBoundingClientRect()
        const top = rect.top + startPos.top
        const bottom = rect.top + (endPos?.top ?? startPos.top) + (startPos.height || 18)
        const left = rect.left + startPos.left
        return { top, bottom, left }
      },
      applyRange: (from, to, text) => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!ed || !model) return
        const end = Math.min(to, model.getValueLength())
        const startP = model.getPositionAt(from)
        const endP = model.getPositionAt(end)
        const range = new monaco.Range(startP.lineNumber, startP.column, endP.lineNumber, endP.column)
        ed.executeEdits("inline-edit", [{ range, text, forceMoveMarkers: true }])
        const afterPos = model.getPositionAt(from + text.length)
        ed.setSelection(new monaco.Selection(startP.lineNumber, startP.column, afterPos.lineNumber, afterPos.column))
        ed.focus()
      },
      getMainRange: () => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!ed || !model) return null
        const sel = ed.getSelection()
        if (!sel) return null
        return {
          from: model.getOffsetAt(sel.getStartPosition()),
          to: model.getOffsetAt(sel.getEndPosition()),
        }
      },
      selectAll: () => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!ed || !model) return
        ed.setSelection(model.getFullModelRange())
        ed.focus()
      },
    }),
    [path],
  )

  return (
    <div onContextMenu={onContextMenu} className="min-h-0 flex-1 overflow-hidden">
      <Editor
        path={path}
        defaultValue={initialText}
        defaultLanguage={monacoLanguageFor(path)}
        theme="codezal"
        onMount={handleMount}
        options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily:
              'var(--codezal-code-font), "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
            lineHeight: 1.65,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderLineHighlight: "line",
            smoothScrolling: false,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            tabSize: 2,
            insertSpaces: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: false, indentation: true },
            padding: { top: 8, bottom: 8 },
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
            },
            contextmenu: false,
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: "on",
            inlineSuggest: { enabled: true },
            renderWhitespace: "selection",
            unicodeHighlight: { ambiguousCharacters: false, nonBasicASCII: false },
            stickyScroll: { enabled: true },
            mouseWheelZoom: false,
            folding: true,
            foldingStrategy: "indentation",
            showFoldingControls: "mouseover",
            lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
        }}
      />
    </div>
  )
}

// LSP → Monaco markers — { line, character } (0-based) → 1-based clamp'li model konumu.
function toMonacoMarkers(model: MonacoNs.ITextModel, diags: LspDiagnostic[]): MonacoNs.IMarkerData[] {
  const sev: Record<number, MonacoNs.IMarkerData["severity"]> = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint,
  }
  return diags.map((d) => {
    const lineCount = model.getLineCount()
    const startLine = Math.min(Math.max(d.range.start.line + 1, 1), lineCount)
    const startCol = Math.min(Math.max(d.range.start.character + 1, 1), model.getLineMaxColumn(startLine))
    let endLine = Math.min(Math.max(d.range.end.line + 1, 1), lineCount)
    let endCol = Math.min(Math.max(d.range.end.character + 1, 1), model.getLineMaxColumn(endLine))
    if (endLine < startLine || (endLine === startLine && endCol < startCol)) {
      endLine = startLine
      endCol = startCol
    }
    if (endLine === startLine && endCol === startCol) {
      endCol = Math.min(startCol + 1, model.getLineMaxColumn(endLine))
    }
    const code = d.code !== undefined ? ` [${d.code}]` : ""
    const src = d.source ? ` (${d.source})` : ""
    return {
      severity: sev[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
      message: `${d.message}${src}${code}`,
      startLineNumber: startLine,
      startColumn: startCol,
      endLineNumber: endLine,
      endColumn: endCol,
      source: d.source,
    }
  })
}
