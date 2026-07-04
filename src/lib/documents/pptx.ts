import { unzip, entryText, entriesUnder, extractTagTexts } from "./zip"

export function pptxToMarkdown(bytes: Uint8Array): string {
  const entries = unzip(bytes)
  const slides = entriesUnder(entries, "ppt/slides/slide", ".xml")
  if (slides.length === 0) return "(PPTX: slayt bulunamadı)"

  const blocks: string[] = []
  slides.forEach((file, i) => {
    const runs = extractTagTexts(entryText(entries, file), "a:t").filter((s) => s.trim() !== "")
    const body = runs.length > 0 ? runs.join("\n") : "(metin yok)"
    blocks.push(`## Slide ${i + 1}\n\n${body}`)
  })
  return blocks.join("\n\n")
}
