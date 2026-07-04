
const MAX_BODY = 8_000

export type ParsedCommandFile = {
  name: string
  description: string
  template: string
  // Per-command overrides (opencode-compat frontmatter).
  agent?: string
  model?: string
  subtask?: boolean
  // Tools this command may NOT use this turn (frontmatter `disallowed-tools`,
  // comma-separated). Removed from the tool set before the turn streams. Entries
  // support a `*` glob (e.g. `mcp__*`) matched against tool names in runStream.
  disallowedTools?: string[]
}

// Frontmatter (---) + body — name/description plus optional agent/model/subtask
// overrides are pulled out; the body becomes the template.
export function parseCommandFile(raw: string, fallbackName: string): ParsedCommandFile {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return { name: fallbackName, description: "", template: raw.slice(0, MAX_BODY) }
  }
  const obj: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/)
    if (!km) continue
    obj[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, "")
  }
  // `disallowed-tools: read_file, bash` (or camelCase) → string[]. Comma-split,
  // trimmed; empty entries dropped.
  const dtRaw = obj["disallowed-tools"] ?? obj["disallowedTools"]
  const disallowedTools = dtRaw
    ? dtRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined
  return {
    name: obj.name ?? fallbackName,
    description: obj.description ?? "",
    template: m[2].slice(0, MAX_BODY),
    ...(obj.agent ? { agent: obj.agent } : {}),
    ...(obj.model ? { model: obj.model } : {}),
    ...(obj.subtask === "true" ? { subtask: true } : {}),
    ...(disallowedTools && disallowedTools.length ? { disallowedTools } : {}),
  }
}

// True if the template references any argument placeholder. Drives the slash
// menu's needsArg hint. Matches $ARGUMENTS, $ARGS, $ARG, $1..$9 and {{arg(s)}}.
// An escaped `\$1` is a literal `$1`, not a placeholder. `$N` counts as a
// placeholder only when preceded by an even (incl. zero) run of backslashes —
// same parity rule renderTemplate applies.
export function templateHasArgs(template: string | undefined): boolean {
  if (!template) return false
  return /\$ARGUMENTS|\$ARGS?|(?<!\\)(?:\\\\)*\$\d|\{\{args?\}\}/.test(template)
}

export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null
  const trimmed = text.slice(1)
  const sp = trimmed.indexOf(" ")
  if (sp === -1) return { name: trimmed, args: "" }
  return { name: trimmed.slice(0, sp), args: trimmed.slice(sp + 1).trim() }
}

// Substitute args into a template. Positional $1..$N map to whitespace-split
// tokens; $ARGUMENTS/$ARGS/$ARG and {{arg(s)}} all expand to the full arg
// string. Order matters: longest named token first so $ARG can't eat the
// "$ARG" prefix of "$ARGUMENTS" and leave a dangling "UMENTS".
// Escape: `\$1` yields a literal `$1` (backslash escapes the `$`, no substitution) —
// lets a body keep a real `$5` price or shell positional. Backslashes are counted:
// an ODD run before `$N` escapes it (emit literal `$N`), an EVEN run (incl. zero)
// leaves it active (substitute); either way each `\\` pair collapses to one `\`.
export function renderTemplate(template: string, args: string): string {
  const parts = args.length ? args.trim().split(/\s+/) : []
  return template
    .replace(/(\\*)\$(\d+)/g, (_m, bs, n) => {
      const half = "\\".repeat(Math.floor(bs.length / 2))
      return bs.length % 2 ? `${half}$${n}` : half + (parts[Number(n) - 1] ?? "")
    })
    .replaceAll("$ARGUMENTS", args)
    .replaceAll("$ARGS", args)
    .replaceAll("$ARG", args)
    .replaceAll("{{args}}", args)
    .replaceAll("{{arg}}", args)
}
