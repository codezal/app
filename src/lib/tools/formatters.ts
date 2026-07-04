
export type FormatterDef = {
  name: string
  extensions: string[]
  // Tespit shell predicate'i — exit 0 → bu workspace'te enabled.
  detect: string
  command: string
  surfaceOutput?: boolean
}

export const FORMATTERS: FormatterDef[] = [
  {
    name: "eslint",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    detect: `command -v npx && [ -f package.json ] && grep -q '"eslint"' package.json`,
    command: "npx --no-install eslint --fix $FILE",
    surfaceOutput: true,
  },
  {
    name: "prettier",
    extensions: [
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
      ".css", ".scss", ".less", ".html",
      ".json", ".jsonc", ".md", ".mdx", ".yaml", ".yml",
      ".vue", ".svelte", ".graphql", ".gql",
    ],
    detect: `command -v npx && [ -f package.json ] && grep -q '"prettier"' package.json`,
    command: "npx --no-install prettier --write $FILE",
  },
  {
    name: "biome",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".css"],
    detect: `command -v npx && { [ -f biome.json ] || [ -f biome.jsonc ]; }`,
    command: "npx --no-install @biomejs/biome format --write $FILE",
  },
  {
    name: "gofmt",
    extensions: [".go"],
    detect: "command -v gofmt",
    command: "gofmt -w $FILE",
  },
  {
    name: "rustfmt",
    extensions: [".rs"],
    detect: "command -v rustfmt",
    command: "rustfmt $FILE",
  },
  {
    name: "ruff",
    extensions: [".py", ".pyi"],
    detect: "command -v ruff",
    command: "ruff format $FILE",
  },
  {
    name: "shfmt",
    extensions: [".sh", ".bash"],
    detect: "command -v shfmt",
    command: "shfmt -w $FILE",
  },
  {
    name: "zig",
    extensions: [".zig", ".zon"],
    detect: "command -v zig",
    command: "zig fmt $FILE",
  },
]

export function extOf(rel: string): string {
  const slash = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"))
  const base = slash === -1 ? rel : rel.slice(slash + 1)
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return ""
  return base.slice(dot).toLowerCase()
}

export function formattersForExt(ext: string): FormatterDef[] {
  if (!ext) return []
  return FORMATTERS.filter((f) => f.extensions.includes(ext))
}

// _clearFormatterCache.
const enabledCache = new Map<string, Map<string, boolean>>()

export function _clearFormatterCache(): void {
  enabledCache.clear()
}

function sq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

function withFile(command: string, file: string): string {
  return command.split("$FILE").join(file)
}

async function isEnabled(workspace: string, def: FormatterDef): Promise<boolean> {
  let ws = enabledCache.get(workspace)
  if (!ws) {
    ws = new Map()
    enabledCache.set(workspace, ws)
  }
  const cached = ws.get(def.name)
  if (cached !== undefined) return cached
  let ok = false
  try {
    const { runBash } = await import("./shell")
    const out = await runBash(
      workspace,
      `{ ${def.detect} ; } >/dev/null 2>&1 && echo __OK__ || true`,
      { timeoutMs: 8000 },
    )
    ok = out.includes("__OK__")
  } catch {
    // Intentionally ignored.
  }
  ws.set(def.name, ok)
  return ok
}

export async function runFormatters(workspace: string, rel: string): Promise<string> {
  const defs = formattersForExt(extOf(rel))
  if (defs.length === 0) return ""
  const file = sq(rel)
  const surfaced: string[] = []
  for (const def of defs) {
    if (!(await isEnabled(workspace, def))) continue
    try {
      const { runBash } = await import("./shell")
      const out = await runBash(
        workspace,
        `${withFile(def.command, file)} 2>&1 || true`,
        { timeoutMs: 15000 },
      )
      if (def.surfaceOutput) {
        const t = out.trim()
        if (t && !/^\[exit 0\]$/.test(t)) surfaced.push(`⚠ ${def.name}:\n${t}`)
      }
    } catch {
      // formatter spawn edilemedi → atla
    }
  }
  return surfaced.join("\n\n")
}
