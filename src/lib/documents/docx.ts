import { unzip, entryText, extractTagTexts } from "./zip"

export function docxToMarkdown(bytes: Uint8Array): string {
  const entries = unzip(bytes)
  const xml = entryText(entries, "word/document.xml")
  if (!xml) return "(DOCX: document.xml bulunamadı)"

  const paras: string[] = []
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let m: RegExpExecArray | null
  while ((m = pRe.exec(xml)) !== null) {
    const text = extractTagTexts(m[1], "w:t").join("")
    paras.push(text)
  }
  if (paras.length === 0) return "(DOCX: paragraf bulunamadı)"
  return paras.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
