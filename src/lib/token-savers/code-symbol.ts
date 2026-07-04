
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
  id: string
  name: string
  kind: SymbolKind
  file: string
  line: number
  sig?: string
}

export function formatSymbol(s: CodeSymbol): string {
  return `${s.file}:${s.line} ${s.kind} ${s.name}${s.sig ? ` — ${s.sig}` : ""}`
}
