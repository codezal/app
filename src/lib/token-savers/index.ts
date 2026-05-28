// Token Savers — Codezal's native token-economy features.
// Three independent toggles, persisted on Settings.tokenSavers:
//   1. Brief Mode      — system-prompt style directive (Caveman-equivalent).
//   2. Compact Output  — shell command output filtering  (RTK-equivalent).  [phase 2]
//   3. Code Map        — AST symbol index + query tools  (CodeGraph-eqv.).  [phase 3]
//
// Each feature can be toggled in Settings → Token Saving. All default off.

export * from "./types"
export { briefModeSection } from "./brief-mode/inject"
export { briefDirective } from "./brief-mode/levels"
export { applyCompact } from "./compact-output/run"
export { detect as detectCommandKind, type CommandKind } from "./compact-output/detect"
export { buildCodeMap, loadCodeMap, type BuildProgress } from "./code-map/indexer"
export {
  searchSymbols,
  resolveByName,
  callers,
  callees,
  trace,
  impact,
  formatSymbol,
  findById,
} from "./code-map/query"
export type { CodeMap, CodeSymbol, CallEdge, SymbolKind } from "./code-map/schema"
