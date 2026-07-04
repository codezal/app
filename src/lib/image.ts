// Image attachment helpers — File/Blob → downscaled base64 data URL.
// Large images bloat token counts, on-disk session JSON, and can exceed
// provider limits, so the longest edge is clamped to MAX_EDGE before encoding.
// Images already within the limit are passed through verbatim (no re-encode,
// preserving the original bytes and transparency).
import type { MessageImage } from "@/store/types"
import { createId } from "@/lib/id"
import { saveImage } from "@/lib/image-store"

// Anthropic recommends ~1568px on the long edge; stay just under it.
const MAX_EDGE = 1536
const MAX_BASE64_BYTES = 4.5 * 1024 * 1024
const JPEG_QUALITIES = [0.85, 0.7, 0.55, 0.4]

const PROVIDER_SAFE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
function isProviderSafe(mime: string): boolean {
  return PROVIDER_SAFE_MIME.has(mime.toLowerCase())
}

export type ImageAttachResult = {
  ok: boolean
  image?: MessageImage
  reason?: "not-image" | "unsupported-format" | "decode-failed"
}

// Convert a picked/pasted/dropped file into a MessageImage. On failure returns a
// reason so the caller can surface a precise toast (mirrors fileToMessagePdf).
export async function fileToMessageImage(file: File): Promise<ImageAttachResult> {
  if (file.type && !file.type.startsWith("image/")) return { ok: false, reason: "not-image" }
  const ds = await downscaleToDataUrl(file)
  if (!ds) {
    return {
      ok: false,
      reason: file.type && !isProviderSafe(file.type) ? "unsupported-format" : "decode-failed",
    }
  }
  const dataUrl = ds.dataUrl
  const mime = mimeFromDataUrl(dataUrl) ?? file.type
  if (!isProviderSafe(mime)) return { ok: false, reason: "unsupported-format" }
  const dims =
    ds.width != null && ds.height != null
      ? { width: ds.width, height: ds.height }
      : await imageDimensions(dataUrl)
  const ref = await saveImage(dataUrl)
  return {
    ok: true,
    image: {
      id: createId("image"),
      ref,
      mime,
      name: file.name || undefined,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    },
  }
}

// data URL → {width,height}. Image element ile decode (CSP-safe; img-src data:
function imageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

type Downscaled = { dataUrl: string; width?: number; height?: number }

async function downscaleToDataUrl(blob: Blob): Promise<Downscaled | null> {
  const bitmap = await loadBitmap(blob)
  if (!bitmap) {
    if (!isProviderSafe(blob.type)) return null
    const raw = await readAsDataUrl(blob)
    return raw ? { dataUrl: raw } : null
  }

  const { width, height } = bitmap
  const png = blob.type === "image/png" || blob.type === "image/gif" || !isProviderSafe(blob.type)

  if (Math.max(width, height) <= MAX_EDGE && isProviderSafe(blob.type)) {
    const raw = await readAsDataUrl(blob)
    if (raw && base64Bytes(raw) <= MAX_BASE64_BYTES) {
      bitmap.close?.()
      return { dataUrl: raw, width, height }
    }
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  let best: Downscaled | null = null
  for (let step = 0; step < 6; step++) {
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const encoded = encodeAtSize(bitmap, w, h, png)
    if (encoded) {
      best = { dataUrl: encoded.dataUrl, width: w, height: h }
      if (encoded.bytes <= MAX_BASE64_BYTES) {
        bitmap.close?.()
        return best
      }
    }
    scale *= 0.8
  }

  bitmap.close?.()
  if (best) return best
  if (!isProviderSafe(blob.type)) return null
  const raw = await readAsDataUrl(blob)
  return raw ? { dataUrl: raw, width, height } : null
}

function encodeAtSize(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  png: boolean,
): { dataUrl: string; bytes: number } | null {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)

  if (png) {
    const dataUrl = canvas.toDataURL("image/png")
    return { dataUrl, bytes: base64Bytes(dataUrl) }
  }
  let smallest: { dataUrl: string; bytes: number } | null = null
  for (const q of JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL("image/jpeg", q)
    const bytes = base64Bytes(dataUrl)
    if (!smallest || bytes < smallest.bytes) smallest = { dataUrl, bytes }
    if (bytes <= MAX_BASE64_BYTES) return { dataUrl, bytes }
  }
  return smallest
}

function base64Bytes(dataUrl: string): number {
  const i = dataUrl.indexOf(";base64,")
  return i === -1 ? dataUrl.length : dataUrl.length - i - ";base64,".length
}

function loadBitmap(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return Promise.resolve(null)
  return createImageBitmap(blob).catch(() => null)
}

function readAsDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

function mimeFromDataUrl(dataUrl: string): string | null {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl)
  return m ? m[1] : null
}
