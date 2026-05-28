// Code Map — minimal symbol graph for "where is X / what calls X / what does
// X call" queries. Persisted as JSON under <workspace>/.codezal/code-map.json.
//
// The MVP uses regex-based extraction, which is fast and dependency-free but
// imprecise: cross-file call edges are inferred by name match (no scope
// resolution). Tree-sitter is a planned upgrade that swaps the parser
// without changing this schema.

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "struct"

export type CodeSymbol = {
  // Stable per-symbol id: "<path>::<name>::<line>" — survives reordering.
  id: string
  name: string
  kind: SymbolKind
  // Workspace-relative path with forward slashes.
  file: string
  // 1-based source line.
  line: number
  // Optional signature snippet (single line).
  sig?: string
}

// "from" calls "to". Both are symbol ids. When the target name has multiple
// definitions (different files), we record one edge per candidate — query
// layer collapses on read.
export type CallEdge = {
  from: string
  to: string
}

export type CodeMap = {
  version: 1
  builtAt: number
  symbols: CodeSymbol[]
  edges: CallEdge[]
  // Lowercased name → list of symbol ids. Speeds up search and call-edge resolution.
  byName: Record<string, string[]>
}

export const CODE_MAP_REL = ".codezal/code-map.json"
