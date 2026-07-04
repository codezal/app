import type { MessagePdf } from "@/store/types"
import { createId } from "@/lib/id"
import { savePdf } from "@/lib/pdf-store"

export const MAX_PDF_BYTES = 32 * 1024 * 1024 // 32MB
export const MAX_PDF_PAGES = 100

export type PdfAttachResult = {
  ok: boolean
  pdf?: MessagePdf
  reason?: "too-large" | "too-many-pages" | "decode"
}

type PdfjsModule = typeof import("pdfjs-dist")
let pdfjsPromise: Promise<PdfjsModule> | null = null

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist")
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })().catch((e) => {
      pdfjsPromise = null
      throw e
    })
  }
  return pdfjsPromise
}

export async function fileToMessagePdf(file: File): Promise<PdfAttachResult> {
  if (file.size > MAX_PDF_BYTES) return { ok: false, reason: "too-large" }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pdfjs = await getPdfjs()
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
    const doc = await loadingTask.promise
    const pages = doc.numPages
    await loadingTask.destroy()
    if (pages > MAX_PDF_PAGES) return { ok: false, reason: "too-many-pages" }
    const ref = await savePdf(bytes)
    return {
      ok: true,
      pdf: {
        id: createId("pdf"),
        ref,
        mime: "application/pdf",
        name: file.name || "document.pdf",
        pages,
        size: file.size,
      },
    }
  } catch (e) {
    console.warn("[pdf] decode/attach failed:", e)
    return { ok: false, reason: "decode" }
  }
}

export async function extractPdfText(
  bytes: Uint8Array,
  maxPages: number = MAX_PDF_PAGES,
): Promise<string> {
  const pdfjs = await getPdfjs()
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await loadingTask.promise
  const out: string[] = []
  try {
    const n = Math.min(doc.numPages, Math.max(1, maxPages))
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i)
      // (mac WKWebView + win WebView2) desteklenir.
      const reader = page.streamTextContent().getReader()
      const parts: string[] = []
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        for (const it of value.items as Array<{ str?: string; hasEOL?: boolean }>) {
          if (typeof it.str === "string") parts.push(it.str + (it.hasEOL ? "\n" : " "))
        }
      }
      out.push(parts.join(""))
      page.cleanup()
    }
    if (doc.numPages > n) out.push(`(… ${doc.numPages - n} sayfa daha kesildi)`)
  } finally {
    await loadingTask.destroy()
  }
  return out.join("\n\n").trim()
}
