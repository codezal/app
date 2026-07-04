
const MAX_ROWS = 1000
const MAX_COLS = 64

function escapeCell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

export function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "(boş tablo)"
  const truncRows = rows.length > MAX_ROWS
  const body = rows.slice(0, MAX_ROWS)
  const cols = Math.min(
    MAX_COLS,
    body.reduce((m, r) => Math.max(m, r.length), 0),
  )
  if (cols === 0) return "(boş tablo)"

  const fmt = (r: string[]) =>
    "| " +
    Array.from({ length: cols }, (_, i) => escapeCell(r[i] ?? "")).join(" | ") +
    " |"

  const header = body[0] ?? []
  const out: string[] = [fmt(header), "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |"]
  for (let i = 1; i < body.length; i++) out.push(fmt(body[i]))

  let result = out.join("\n")
  if (truncRows) result += `\n\n(${rows.length} satırdan ilk ${MAX_ROWS}'i gösteriliyor)`
  return result
}
