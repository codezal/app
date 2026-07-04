export const MAX_IMPORT_DEPTH = 5

export type ImportResolver = {
  resolve: (importPath: string, baseDir: string) => string | null
  // Absolute path'i oku; okunamazsa null.
  read: (absPath: string) => Promise<string | null>
  dirOf: (absPath: string) => string
}

function lineImports(line: string): string[] {
  const masked = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length))
  const re = /(?:^|\s)@([^\s]+)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    let p = m[1]
    p = p.replace(/[),.;:]+$/, "")
    if (!p) continue
    const looksLikePath = p.includes("/") || /\.(md|mdc|markdown|txt)$/i.test(p)
    if (!looksLikePath) continue
    out.push(p)
  }
  return out
}

async function expand(
  content: string,
  baseDir: string,
  r: ImportResolver,
  visited: Set<string>,
  depth: number,
): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return content

  const lines = content.split("\n")
  const out: string[] = []
  let inFence = false

  for (const line of lines) {
    const isFence = line.trimStart().startsWith("```")
    if (isFence) {
      inFence = !inFence
      out.push(line)
      continue
    }
    out.push(line)
    if (inFence) continue

    for (const importPath of lineImports(line)) {
      const abs = r.resolve(importPath, baseDir)
      if (!abs) continue
      if (visited.has(abs)) continue
      visited.add(abs)
      const raw = await r.read(abs)
      if (raw == null) continue
      const inner = await expand(raw, r.dirOf(abs), r, visited, depth + 1)
      out.push(`<!-- @import ${importPath} -->`)
      out.push(inner.trim())
      out.push(`<!-- /@import ${importPath} -->`)
    }
  }

  return out.join("\n")
}

export async function expandImports(
  content: string,
  baseDir: string,
  r: ImportResolver,
): Promise<string> {
  return expand(content, baseDir, r, new Set<string>(), 0)
}
