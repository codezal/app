//
import { unzip, entryText, extractTagTexts, decodeXmlEntities } from "./zip"
import { toMarkdownTable } from "./table"

function colIndex(ref: string): number {
  const m = ref.match(/^([A-Z]+)/)
  if (!m) return 0
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return []
  const out: string[] = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(extractTagTexts(m[1], "t").join(""))
  }
  return out
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(xml)) !== null) {
    const cells: string[] = []
    const cellRe = /<c\s+([^>]*?)\/?>(?:([\s\S]*?)<\/c>)?/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const attrs = cm[1]
      const inner = cm[2] ?? ""
      const refM = attrs.match(/r="([A-Z]+\d+)"/)
      const typeM = attrs.match(/t="([^"]+)"/)
      const ci = refM ? colIndex(refM[1]) : cells.length
      const t = typeM?.[1]
      let value: string
      if (t === "s") {
        const vM = inner.match(/<v>([\s\S]*?)<\/v>/)
        const idx = vM ? parseInt(vM[1], 10) : -1
        value = idx >= 0 && idx < shared.length ? shared[idx] : ""
      } else if (t === "inlineStr") {
        value = extractTagTexts(inner, "t").join("")
      } else {
        const vM = inner.match(/<v>([\s\S]*?)<\/v>/)
        value = vM ? decodeXmlEntities(vM[1]) : ""
      }
      cells[ci] = value
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ""
    rows.push(cells)
  }
  return rows
}

function sheetNames(workbookXml: string): string[] {
  const out: string[] = []
  const re = /<sheet\b[^>]*\bname="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(workbookXml)) !== null) out.push(decodeXmlEntities(m[1]))
  return out
}

export function xlsxToMarkdown(bytes: Uint8Array): string {
  const entries = unzip(bytes)
  const shared = parseSharedStrings(entryText(entries, "xl/sharedStrings.xml"))
  const names = sheetNames(entryText(entries, "xl/workbook.xml"))

  const sheetFiles = Object.keys(entries)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)/)![1], 10)
      const nb = parseInt(b.match(/sheet(\d+)/)![1], 10)
      return na - nb
    })

  if (sheetFiles.length === 0) return "(XLSX: worksheet bulunamadı)"

  const blocks: string[] = []
  sheetFiles.forEach((file, i) => {
    const grid = parseSheet(entryText(entries, file), shared)
    const name = names[i] ?? `Sheet${i + 1}`
    if (grid.length === 0) {
      blocks.push(`## ${name}\n\n(boş sayfa)`)
    } else {
      blocks.push(`## ${name}\n\n${toMarkdownTable(grid)}`)
    }
  })
  return blocks.join("\n\n")
}
