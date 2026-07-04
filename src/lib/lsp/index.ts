// LSP module — code intelligence via language servers (hover, definition,
// references, diagnostics) over the Rust Tauri bridge in src-tauri/src/lsp.rs.
export {
  lspHover,
  lspDefinition,
  lspReferences,
  lspImplementation,
  lspDocumentSymbol,
  lspWorkspaceSymbol,
  lspPrepareCallHierarchy,
  lspIncomingCalls,
  lspOutgoingCalls,
  lspDiagnostics,
  lspEditSession,
  shutdownAllLsp,
  type LspQuery,
  type LspResult,
  type LspUnavailable,
  type LspEditHandle,
} from "./manager"
export { uriToPath, uriMatchesPath } from "./uri"
export {
  SERVERS,
  serverForPath,
  archiveFormat,
  type LspServer,
  type ServerDownload,
  type ServerBundled,
} from "./servers"
export {
  installServer,
  resolveInstalled,
  resolveBundled,
  type InstallProgress,
  type ResolvedCommand,
} from "./download"
export { languageForPath, LANGUAGE_EXTENSIONS } from "./language"
export type {
  LspClient,
  LspDiagnostic,
  LspPosition,
  LspRange,
  DiagnosticsEvent,
} from "./client"
