// Slash komut parse helper'ları — paylaşılan utility.
// Hem user/plugin .md dosyalarını parse eder hem chat input'undaki `/cmd args` formatını çözer.

const MAX_BODY = 8_000

export type ParsedCommandFile = {
  name: string
  description: string
  template: string
}

// Frontmatter (---) + body — name, description çekilir, body template olur.
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
  return {
    name: obj.name ?? fallbackName,
    description: obj.description ?? "",
    template: m[2].slice(0, MAX_BODY),
  }
}

// `/cmd args…` parse — komut adı + arg
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null
  const trimmed = text.slice(1)
  const sp = trimmed.indexOf(" ")
  if (sp === -1) return { name: trimmed, args: "" }
  return { name: trimmed.slice(0, sp), args: trimmed.slice(sp + 1).trim() }
}

// Template'e arg yerleştir. $ARG / $ARGS / {{arg}} desteklenir.
export function renderTemplate(template: string, args: string): string {
  return template
    .replaceAll("$ARGS", args)
    .replaceAll("$ARG", args)
    .replaceAll("{{arg}}", args)
    .replaceAll("{{args}}", args)
}
