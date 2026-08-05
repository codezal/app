// Image attachment helpers — File/Blob → downscaled base64 data URL.
// Small / already-safe images pass through unchanged (PNG alpha, GIF, WebP
// preserved). Oversized images are re-encoded: alpha formats try PNG first,
// then JPEG with a white flatten if the budget still overflows.
import type { MessageImage } from "@/store/types"
import { createId } from "@/lib/id"
import { saveImage } from "@/lib/image-store"
import { applyExifTransform, readExifOrientation } from "@/lib/exif-orientation"

// Anthropic recommends ~1568px on the long edge; stay just under it.
const MAX_EDGE = 1536
const MAX_BASE64_BYTES = 4.5 * 1024 * 1024
// Re-encode quality when we must compress to JPEG.
const JPEG_QUALITY = 0.85

const PROVIDER_SAFE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
function isProviderSafe(mime: string): boolean {
  return PROVIDER_SAFE_MIME.has(mime.toLowerCase())
}

function hasAlphaMime(mime: string): boolean {
  return /png|webp|gif/.test(mime.toLowerCase())
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
      // Unsupported source format that we re-encoded (BMP/TIFF/etc → PNG/JPEG):
      // record it so the model can be told the pixels were converted (Pi-style).
      ...(file.type && file.type !== mime ? { convertedFrom: file.type } : {}),
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
  const loaded = await loadBitmap(blob)
  if (!loaded) {
    if (!isProviderSafe(blob.type)) return null
    const raw = await readAsDataUrl(blob)
    return raw ? { dataUrl: raw } : null
  }
  let bitmap = loaded.bitmap

  // Pixel-correct EXIF rotation when we decoded raw pixels (Pi-style: photos
  // from phones arrive rotated; re-encoding to PNG/JPEG drops the EXIF tag, so
  // the transform must be baked into the pixels before storage).
  if (loaded.raw) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const orientation = readExifOrientation(bytes)
      if (orientation !== 1) {
        const fixed = await applyExifTransform(bitmap, orientation)
        if (fixed) {
          bitmap.close?.()
          bitmap = fixed
        }
      }
    } catch {
      // EXIF correction is best-effort — never fail the attach over it.
    }
  }

  const { width, height } = bitmap
  const withinDim = Math.max(width, height) <= MAX_EDGE

  // Pass-through: already within the long-edge cap, provider-safe, and under the
  // base64 budget. Preserves PNG alpha / GIF / WebP instead of forcing JPEG.
  if (withinDim && isProviderSafe(blob.type)) {
    const raw = await readAsDataUrl(blob)
    if (raw && base64Bytes(raw) <= MAX_BASE64_BYTES) {
      bitmap.close?.()
      return { dataUrl: raw, width, height }
    }
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const preferPng = hasAlphaMime(blob.type)
  let best: Downscaled | null = null
  for (let step = 0; step < 6; step++) {
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    // Alpha sources: try PNG first so transparency survives when it fits.
    if (preferPng) {
      const png = encodeAtSize(bitmap, w, h, "image/png")
      if (png) {
        best = { dataUrl: png.dataUrl, width: w, height: h }
        if (png.bytes <= MAX_BASE64_BYTES) {
          bitmap.close?.()
          return best
        }
      }
    }
    const jpeg = encodeAtSize(bitmap, w, h, "image/jpeg", JPEG_QUALITY)
    if (jpeg) {
      best = { dataUrl: jpeg.dataUrl, width: w, height: h }
      if (jpeg.bytes <= MAX_BASE64_BYTES) {
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
  mime: "image/jpeg" | "image/png",
  quality?: number,
): { dataUrl: string; bytes: number } | null {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  // JPEG has no alpha — flatten transparency onto a white background first.
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(bitmap, 0, 0, w, h)

  const dataUrl = mime === "image/jpeg" ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime)
  return { dataUrl, bytes: base64Bytes(dataUrl) }
}

function base64Bytes(dataUrl: string): number {
  const i = dataUrl.indexOf(";base64,")
  return i === -1 ? dataUrl.length : dataUrl.length - i - ";base64,".length
}

// `raw: true` means we decoded with imageOrientation:"none" — the bitmap has NOT
// had EXIF applied by the browser, so the caller must pixel-correct it. `raw:
// false` is the plain-call fallback where the browser already applied EXIF
// (default "from-image") and we must NOT double-rotate.
async function loadBitmap(blob: Blob): Promise<{ bitmap: ImageBitmap; raw: boolean } | null> {
  if (typeof createImageBitmap !== "function") return Promise.resolve(null)
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "none" } as ImageBitmapOptions)
    return { bitmap: bmp, raw: true }
  } catch {
    try {
      return { bitmap: await createImageBitmap(blob), raw: false }
    } catch {
      return null
    }
  }
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
