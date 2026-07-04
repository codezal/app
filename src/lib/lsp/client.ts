// LSP client — thin wrapper over the Rust Tauri commands in src-tauri/src/lsp.rs.
// One client = one running language-server process (keyed by id on the Rust side).
// Positions are 0-based (LSP spec); callers that use 1-based lines convert first.
import { invoke } from "@tauri-apps/api/core"
import { type UnlistenFn } from "@tauri-apps/api/event"
import { bufferedListen } from "@/lib/tauri-events"
import type { LspServer } from "./servers"

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export type LspDiagnostic = {
  range: LspRange
  severity?: 1 | 2 | 3 | 4 // 1=Error 2=Warning 3=Info 4=Hint
  code?: string | number
  source?: string
  message: string
}

export type DiagnosticsEvent = { uri: string; diagnostics: LspDiagnostic[] }

// LSP Location / LocationLink shapes are loose across servers — keep as unknown
// and let the consumer (AI tool / UI) shape them.
export type LspClient = {
  id: string
  server: LspServer
  openFile: (filePath: string, content: string) => Promise<void>
  changeFile: (filePath: string, content: string) => Promise<void>
  closeFile: (filePath: string) => Promise<void>
  hover: (filePath: string, line: number, character: number) => Promise<unknown>
  definition: (filePath: string, line: number, character: number) => Promise<unknown>
  references: (filePath: string, line: number, character: number) => Promise<unknown>
  implementation: (filePath: string, line: number, character: number) => Promise<unknown>
  documentSymbol: (filePath: string) => Promise<unknown>
  workspaceSymbol: (query: string) => Promise<unknown>
  prepareCallHierarchy: (filePath: string, line: number, character: number) => Promise<unknown>
  incomingCalls: (item: unknown) => Promise<unknown>
  outgoingCalls: (item: unknown) => Promise<unknown>
  getDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>
  codeAction: (
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    diagnostics: unknown[],
  ) => Promise<unknown>
  resolveCodeAction: (action: unknown) => Promise<unknown>
  executeCommand: (command: string, args: unknown[]) => Promise<unknown>
  onDiagnostics: (cb: (ev: DiagnosticsEvent) => void) => Promise<UnlistenFn>
  stop: () => Promise<void>
}

export async function startClient(
  id: string,
  workspaceRoot: string,
  server: LspServer,
  // Resolved executable (PATH name, cached path, or bundled Bun). Defaults to server.command.
  command: string = server.command,
  // Resolved args (bundled prepends the JS entry). Defaults to server.args.
  args: string[] = server.args,
  initializationOptions: unknown | null = null,
): Promise<LspClient> {
  const diagnostics = await bufferedListen<DiagnosticsEvent>(`lsp:diagnostics:${id}`)

  try {
    await invoke<string>("lsp_start", {
      id,
      workspaceRoot,
      serverCmd: command,
      serverArgs: args,
      initializationOptions,
    })
  } catch (e) {
    diagnostics.dispose()
    throw e
  }

  return {
    id,
    server,
    openFile: (filePath, content) => invoke("lsp_open_file", { id, filePath, content }),
    changeFile: (filePath, content) => invoke("lsp_change_file", { id, filePath, content }),
    closeFile: (filePath) => invoke("lsp_close_file", { id, filePath }),
    hover: (filePath, line, character) => invoke("lsp_hover", { id, filePath, line, character }),
    definition: (filePath, line, character) =>
      invoke("lsp_definition", { id, filePath, line, character }),
    references: (filePath, line, character) =>
      invoke("lsp_references", { id, filePath, line, character }),
    implementation: (filePath, line, character) =>
      invoke("lsp_implementation", { id, filePath, line, character }),
    documentSymbol: (filePath) => invoke("lsp_document_symbol", { id, filePath }),
    workspaceSymbol: (query) => invoke("lsp_workspace_symbol", { id, query }),
    prepareCallHierarchy: (filePath, line, character) =>
      invoke("lsp_prepare_call_hierarchy", { id, filePath, line, character }),
    incomingCalls: (item) => invoke("lsp_incoming_calls", { id, item }),
    outgoingCalls: (item) => invoke("lsp_outgoing_calls", { id, item }),
    getDiagnostics: (filePath) => invoke<LspDiagnostic[]>("lsp_get_diagnostics", { id, filePath }),
    codeAction: (filePath, startLine, startCharacter, endLine, endCharacter, diagnostics) =>
      invoke("lsp_code_action", {
        args: { id, filePath, startLine, startCharacter, endLine, endCharacter, diagnostics },
      }),
    resolveCodeAction: (action) => invoke("lsp_resolve_code_action", { id, codeAction: action }),
    executeCommand: (command, args) => invoke("lsp_execute_command", { id, command, arguments: args }),
    onDiagnostics: async (cb) => {
      return diagnostics.attach(cb)
    },
    stop: async () => {
      diagnostics.dispose()
      try {
        await invoke("lsp_stop", { id })
      } catch {
        // Already stopped — ignore.
      }
    },
  }
}
