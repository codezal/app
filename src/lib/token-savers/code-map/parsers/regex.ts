// Regex-based symbol extractor. Two passes per file:
//   1. Definitions  — function/class/method/struct/enum/etc. by language.
//   2. Call sites   — `name(` occurrences inside the file; matched against
//      a global byName map by the indexer to produce CallEdge entries.
//
// Limitations (acknowledged, will be addressed by a future tree-sitter pass):
//   - String/comment contents are NOT stripped, so identifiers inside strings
//     can produce phantom calls. The byName index filter mitigates this.
//   - Method calls (`a.foo()`) match `foo` only — no receiver resolution.
//   - Destructured names (`const { a, b } = obj`) are not tracked.
//   - JSX components show up as calls of their tag name (acceptable —
//     `<MyButton />` really is "use MyButton").

import type { CodeSymbol, SymbolKind } from "../schema"

export type ParsedFile = {
  symbols: CodeSymbol[]
  // Calls found in this file with their source line — resolved to symbol ids
  // later by the indexer once it has the global byName map.
  rawCalls: Array<{ name: string; line: number }>
  // Owning symbol per source line, computed naively from definition order
  // (callers attribute their calls to the most recently opened symbol).
  ownerByLine: string[]
}

type Pattern = {
  kind: SymbolKind
  // Capture group 1 must be the name.
  re: RegExp
}

const PATTERNS_BY_LANG: Record<string, Pattern[]> = {
  ts: [
    { kind: "function", re: /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]/g },
    { kind: "class", re: /(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: "interface", re: /(?:^|\s)(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g },
    { kind: "type", re: /(?:^|\s)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g },
    { kind: "enum", re: /(?:^|\s)(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g },
    { kind: "const", re: /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=\s*(?:async\s*)?\([^)]*\)\s*=>)/g },
    // Methods inside classes — heuristic: word followed by `(...)` then `{`
    // sitting on a line by itself. False positives possible; acceptable for MVP.
    { kind: "method", re: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/gm },
  ],
  py: [
    { kind: "function", re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm },
    { kind: "class", re: /^\s*class\s+([A-Za-z_][\w]*)/gm },
  ],
  rs: [
    { kind: "function", re: /(?:^|\s)(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/g },
    { kind: "struct", re: /(?:^|\s)(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/g },
    { kind: "enum", re: /(?:^|\s)(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/g },
  ],
  go: [
    { kind: "function", re: /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)/gm },
    { kind: "struct", re: /^type\s+([A-Za-z_][\w]*)\s+struct/gm },
    { kind: "type", re: /^type\s+([A-Za-z_][\w]*)\s+(?!struct)/gm },
  ],
  java: [
    { kind: "class", re: /(?:^|\s)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|static\s+)*class\s+([A-Za-z_][\w]*)/g },
    { kind: "interface", re: /(?:^|\s)(?:public\s+|private\s+|protected\s+)*interface\s+([A-Za-z_][\w]*)/g },
    { kind: "method", re: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)+\S+\s+([A-Za-z_][\w]*)\s*\(/gm },
  ],
}

// Call sites — generic across languages. Excludes language keywords by a
// blocklist passed in (so `if (...)`, `while (...)` aren't logged as calls).
const CALL_SITE_RE = /([A-Za-z_$][\w$]*)\s*\(/g

const KEYWORDS_PER_LANG: Record<string, Set<string>> = {
  ts: new Set([
    "if", "else", "for", "while", "do", "switch", "case", "return", "typeof",
    "instanceof", "in", "of", "new", "void", "await", "yield", "throw", "catch",
    "try", "finally", "import", "export", "from", "as", "is", "function",
    "class", "interface", "type", "enum", "const", "let", "var", "extends",
    "implements", "this", "super", "true", "false", "null", "undefined",
  ]),
  py: new Set([
    "if", "elif", "else", "for", "while", "return", "import", "from", "as",
    "with", "def", "class", "lambda", "yield", "raise", "try", "except",
    "finally", "pass", "True", "False", "None", "print", "and", "or", "not",
    "in", "is",
  ]),
  rs: new Set([
    "if", "else", "for", "while", "loop", "match", "return", "let", "mut",
    "fn", "pub", "use", "mod", "struct", "enum", "impl", "trait", "where",
    "as", "self", "Self", "super", "crate", "ref", "true", "false",
  ]),
  go: new Set([
    "if", "else", "for", "switch", "case", "default", "return", "func",
    "type", "struct", "interface", "package", "import", "go", "defer", "var",
    "const", "map", "chan", "select", "range", "true", "false", "nil",
  ]),
  java: new Set([
    "if", "else", "for", "while", "do", "switch", "case", "return", "new",
    "class", "interface", "public", "private", "protected", "static", "final",
    "abstract", "void", "this", "super", "throw", "throws", "try", "catch",
    "finally", "true", "false", "null",
  ]),
}

export function extToLang(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mts":
    case ".mjs":
    case ".cjs":
      return "ts"
    case ".py":
      return "py"
    case ".rs":
      return "rs"
    case ".go":
      return "go"
    case ".java":
      return "java"
    default:
      return null
  }
}

function lineOfOffset(src: string, offset: number): number {
  // 1-based line index. Counts \n up to (not including) offset.
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++
  }
  return line
}

export function parseSource(
  file: string,
  text: string,
  lang: string,
): ParsedFile {
  const patterns = PATTERNS_BY_LANG[lang] ?? []
  const keywords = KEYWORDS_PER_LANG[lang] ?? new Set<string>()
  const lineCount = text.split("\n").length

  const symbols: CodeSymbol[] = []
  // Symbol definitions sorted by line for ownerByLine assignment later.
  const defAtLine: Array<{ line: number; id: string }> = []

  for (const pat of patterns) {
    pat.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pat.re.exec(text)) !== null) {
      const name = m[1]
      if (!name) continue
      const offset = m.index + (m[0].indexOf(name) >= 0 ? m[0].indexOf(name) : 0)
      const line = lineOfOffset(text, offset)
      const id = `${file}::${name}::${line}`
      // Single-line signature snippet (truncated to keep index tight).
      const lineEnd = text.indexOf("\n", offset)
      const sigEnd = lineEnd === -1 ? text.length : lineEnd
      const sig = text.slice(offset, sigEnd).trim().slice(0, 160)
      symbols.push({ id, name, kind: pat.kind, file, line, sig })
      defAtLine.push({ line, id })
    }
  }

  // Owner per line — naïve: every line is "owned" by the most recently
  // started symbol. Good enough for call attribution at MVP quality.
  defAtLine.sort((a, b) => a.line - b.line)
  const ownerByLine: string[] = new Array(lineCount + 1).fill("")
  let defIdx = 0
  let currentOwner = ""
  for (let ln = 1; ln <= lineCount; ln++) {
    while (defIdx < defAtLine.length && defAtLine[defIdx]!.line <= ln) {
      currentOwner = defAtLine[defIdx]!.id
      defIdx++
    }
    ownerByLine[ln] = currentOwner
  }

  // Call sites — collect all `name(` occurrences minus keywords + the
  // definition lines themselves (so we don't log `function foo(` as a call to foo).
  const defLines = new Set(defAtLine.map((d) => d.line))
  CALL_SITE_RE.lastIndex = 0
  const rawCalls: Array<{ name: string; line: number }> = []
  let cm: RegExpExecArray | null
  while ((cm = CALL_SITE_RE.exec(text)) !== null) {
    const name = cm[1]
    if (!name) continue
    if (keywords.has(name)) continue
    const line = lineOfOffset(text, cm.index)
    if (defLines.has(line) && cm.index === text.indexOf(name, text.lastIndexOf("\n", cm.index) + 1)) {
      // Same line as a definition AND first occurrence — skip to avoid self-call.
      continue
    }
    rawCalls.push({ name, line })
  }

  return { symbols, rawCalls, ownerByLine }
}
