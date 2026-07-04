// Token Savers — Codezal's native token-economy features.
// Toggles persisted on Settings.tokenSavers:
//   1. Brief Mode               — system-prompt style directive (Caveman-equivalent).
//   2. Compact Output           — shell command output filtering  (RTK-equivalent).
//   3. Code Map                 — AST symbol index + query tools  (CodeGraph-eqv.).
//   4. Deferred MCP Tools       — load tool schemas on demand via tool_search.
//
// Each feature can be toggled in Settings → Token Saving. All default off.

export * from "./types"
export { briefModeSection } from "./brief-mode/inject"
export { briefDirective } from "./brief-mode/levels"
export { applyCompact } from "./compact-output/run"
export { detect as detectCommandKind, type CommandKind } from "./compact-output/detect"
export { compactToolDescriptionsInPlace } from "./compress-tools"
export { compressProse } from "./compress-tools/prose"
export {
  applyHistoryHygiene,
  type HistoryHygieneOptions,
  type HistoryHygieneResult,
} from "./history-hygiene"
export { formatSymbol, type CodeSymbol, type SymbolKind } from "./code-symbol"
