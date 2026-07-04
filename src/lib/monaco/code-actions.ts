// LSP `textDocument/codeAction` server-spesifik veriler (data, edit, command, kind)
import type { editor as MonacoEditor, languages as MonacoLang, IRange } from "monaco-editor"
import { monaco } from "./setup"
import type { LspEditHandle } from "@/lib/lsp"

// LSP Diagnostic 0-based; Monaco IMarkerData 1-based. Marker → LSP Diagnostic
function markerToLspDiag(m: MonacoEditor.IMarkerData): Record<string, unknown> {
  const sev =
    m.severity === monaco.MarkerSeverity.Error
      ? 1
      : m.severity === monaco.MarkerSeverity.Warning
        ? 2
        : m.severity === monaco.MarkerSeverity.Info
          ? 3
          : 4
  return {
    range: {
      start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
      end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
    },
    severity: sev,
    message: m.message,
    source: m.source,
    code: m.code,
  }
}

function lspRangeToMonaco(r: unknown): IRange {
  const rr = (r ?? {}) as { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
  const sl = (rr.start?.line ?? 0) + 1
  const sc = (rr.start?.character ?? 0) + 1
  const el = (rr.end?.line ?? 0) + 1
  const ec = (rr.end?.character ?? 0) + 1
  return { startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec }
}

// LSP WorkspaceEdit → Monaco WorkspaceEdit. Hem `changes` (legacy) hem
export function convertLspWorkspaceEdit(lspEdit: unknown): MonacoLang.WorkspaceEdit {
  const edits: MonacoLang.IWorkspaceTextEdit[] = []
  const w = lspEdit as
    | {
        changes?: Record<string, Array<{ range: unknown; newText: string }>>
        documentChanges?: Array<{
          textDocument?: { uri?: string }
          edits?: Array<{ range: unknown; newText: string }>
        }>
      }
    | undefined

  const push = (uri: string, textEdits: Array<{ range: unknown; newText: string }>) => {
    let resource
    try {
      resource = monaco.Uri.parse(uri)
    } catch {
      return
    }
    for (const te of textEdits) {
      edits.push({
        resource,
        versionId: undefined,
        textEdit: {
          range: lspRangeToMonaco(te.range),
          text: typeof te.newText === "string" ? te.newText : "",
        },
      })
    }
  }

  if (w?.changes && typeof w.changes === "object") {
    for (const uri of Object.keys(w.changes)) {
      const arr = w.changes[uri]
      if (Array.isArray(arr)) push(uri, arr)
    }
  }
  if (Array.isArray(w?.documentChanges)) {
    for (const dc of w.documentChanges) {
      const uri = dc?.textDocument?.uri
      if (typeof uri === "string" && Array.isArray(dc.edits)) push(uri, dc.edits)
    }
  }

  return { edits }
}

type CodeActionWithRaw = MonacoLang.CodeAction & { __lspRaw?: unknown }

function lspActionToMonaco(raw: unknown): CodeActionWithRaw | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as {
    title?: unknown
    kind?: unknown
    isPreferred?: unknown
    disabled?: { reason?: unknown }
    edit?: unknown
    command?: { command?: unknown; title?: unknown; arguments?: unknown }
  }
  if (typeof r.title !== "string" || !r.title) return null

  const action: CodeActionWithRaw = {
    title: r.title,
    kind: typeof r.kind === "string" ? r.kind : "quickfix",
    isPreferred: Boolean(r.isPreferred),
    disabled:
      r.disabled && typeof r.disabled.reason === "string" ? r.disabled.reason : undefined,
  }

  if (r.edit) {
    action.edit = convertLspWorkspaceEdit(r.edit)
  }
  if (r.command && typeof r.command.command === "string") {
    action.command = {
      id: r.command.command,
      title: typeof r.command.title === "string" ? r.command.title : action.title,
      arguments: Array.isArray(r.command.arguments) ? r.command.arguments : undefined,
    }
  }

  action.__lspRaw = raw
  return action
}

const AI_FIX_COMMAND = "codezal.aiFix"
let aiFixRegistered = false

function ensureAiFixCommand(): void {
  if (aiFixRegistered) return
  aiFixRegistered = true
  monaco.editor.registerCommand(AI_FIX_COMMAND, (_accessor, payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("codezal:ai-fix", { detail: payload }))
    }
  })
}

function buildAiFixAction(
  model: MonacoEditor.ITextModel,
  markers: readonly MonacoEditor.IMarkerData[],
): MonacoLang.CodeAction {
  const minLine = Math.min(...markers.map((m) => m.startLineNumber))
  const maxLine = Math.max(...markers.map((m) => m.endLineNumber))
  const startLine = Math.max(1, minLine - 2)
  const endLine = Math.min(model.getLineCount(), maxLine + 2)
  const code = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine),
  })
  const diagnostics = markers.map((m) => ({ message: m.message, line: m.startLineNumber }))
  return {
    title: "✨ Claude ile düzelt",
    kind: "quickfix",
    command: {
      id: AI_FIX_COMMAND,
      title: "Claude ile düzelt",
      arguments: [{ path: model.uri.path, diagnostics, code, startLine }],
    },
  }
}

export function registerLspCodeActionProvider(
  languages: string[],
  getSession: () => LspEditHandle | null,
): MonacoLang.CodeActionProvider & { dispose: () => void } {
  ensureAiFixCommand()
  const provider: MonacoLang.CodeActionProvider = {
    provideCodeActions: async (model, range, context) => {
      const actions: MonacoLang.CodeAction[] = []
      const session = getSession()

      if (session) {
        const diags = context.markers.map(markerToLspDiag)
        let result: unknown
        try {
          result = await session.codeAction(
            range.startLineNumber - 1,
            range.startColumn - 1,
            range.endLineNumber - 1,
            range.endColumn - 1,
            diags,
          )
        } catch {
          result = null
        }
        if (Array.isArray(result)) {
          for (const raw of result) {
            const a = lspActionToMonaco(raw)
            if (a) actions.push(a)
          }
        }
      }

      if (context.markers.length > 0) {
        actions.push(buildAiFixAction(model, context.markers))
      }

      return { actions, dispose: () => {} }
    },
    resolveCodeAction: async (action) => {
      const session = getSession()
      if (!session) return action
      const raw = (action as CodeActionWithRaw).__lspRaw
      if (!raw) return action
      if (action.edit && Array.isArray(action.edit.edits) && action.edit.edits.length > 0) {
        return action
      }
      try {
        const resolved = (await session.resolveCodeAction(raw)) as { edit?: unknown } | null
        if (resolved?.edit) {
          action.edit = convertLspWorkspaceEdit(resolved.edit)
        }
      } catch {
        // Intentionally ignored.
      }
      return action
    },
  }

  const reg = monaco.languages.registerCodeActionProvider(languages, provider)
  return { ...provider, dispose: () => reg.dispose() }
}
