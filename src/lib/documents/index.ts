//
import { xlsxToMarkdown } from "./xlsx"
import { pptxToMarkdown } from "./pptx"
import { docxToMarkdown } from "./docx"
import { csvToMarkdown } from "./csv"

export { csvToMarkdown, parseDelimited } from "./csv"
export { xlsxToMarkdown } from "./xlsx"
export { pptxToMarkdown } from "./pptx"
export { docxToMarkdown } from "./docx"

export type DocFormat = "xlsx" | "pptx" | "docx" | "csv" | "tsv"

const BINARY_DOC_EXT: Record<string, DocFormat> = { xlsx: "xlsx", pptx: "pptx", docx: "docx" }
const TEXT_DOC_EXT: Record<string, DocFormat> = { csv: "csv", tsv: "tsv" }

function ext(name: string): string {
  const i = name.lastIndexOf(".")
  return i === -1 ? "" : name.slice(i + 1).toLowerCase()
}

export function isBinaryDoc(name: string): boolean {
  return ext(name) in BINARY_DOC_EXT
}

export function isOfficeDoc(name: string): boolean {
  const e = ext(name)
  return e in BINARY_DOC_EXT || e in TEXT_DOC_EXT
}

export function docFormat(name: string): DocFormat | undefined {
  const e = ext(name)
  return BINARY_DOC_EXT[e] ?? TEXT_DOC_EXT[e]
}

export function extractBinaryDoc(bytes: Uint8Array, filename: string): string {
  const fmt = BINARY_DOC_EXT[ext(filename)]
  try {
    switch (fmt) {
      case "xlsx":
        return xlsxToMarkdown(bytes)
      case "pptx":
        return pptxToMarkdown(bytes)
      case "docx":
        return docxToMarkdown(bytes)
      default:
        return `(desteklenmeyen doküman: ${filename})`
    }
  } catch (e) {
    return `(${fmt?.toUpperCase() ?? "doküman"} ayrıştırılamadı: ${filename} — ${e instanceof Error ? e.message : String(e)})`
  }
}

export function extractTextDoc(text: string, filename: string): string {
  const fmt = TEXT_DOC_EXT[ext(filename)]
  const delim = fmt === "tsv" ? "\t" : fmt === "csv" ? "," : undefined
  return csvToMarkdown(text, delim)
}
