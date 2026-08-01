// Wire-format helpers for multimodal image parts.
//
// History stays JSON-safe (data: URLs / refs). Right before streamText we
// downscale oversized images (Pi-style 2000px / ~4.5 MB base64), then
// materialize inline images to Uint8Array so the AI SDK treats them as `data`
// parts — never as remote URLs. DashScope Qwen otherwise tries to HTTP-fetch
// anything it thinks is a URL and 400s with "Download multimodal file timed out".

import type { ModelMessage } from "ai"

export function parseDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  if (!dataUrl.startsWith("data:")) return null
  const comma = dataUrl.indexOf(",")
  if (comma < 0) return null
  const meta = dataUrl.slice(5, comma) // after "data:"
  const mime = meta.split(";")[0] || "application/octet-stream"
  const payload = dataUrl.slice(comma + 1)
  try {
    const binary = meta.includes("base64") ? atob(payload) : decodeURIComponent(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { bytes, mime }
  } catch {
    return null
  }
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Base64 payload length of a data URL (not the full string length). */
export function dataUrlBase64Length(dataUrl: string): number {
  const i = dataUrl.indexOf(";base64,")
  return i === -1 ? dataUrl.length : dataUrl.length - i - ";base64,".length
}

type AnyPart = Record<string, unknown> & { type?: string }

// Convert inline data-URL image/file parts to byte payloads. Leaves http(s)
// URLs alone (caller/provider may support them). Idempotent for already-bytes.
export function materializeInlineImages(msgs: ModelMessage[]): ModelMessage[] {
  return msgs.map((m) => {
    if (!Array.isArray(m.content)) return m
    let changed = false
    const content = m.content.map((p) => {
      const part = p as AnyPart
      if (part.type === "image" && typeof part.image === "string") {
        const parsed = parseDataUrl(part.image)
        if (parsed) {
          changed = true
          const mediaType =
            typeof part.mediaType === "string" && part.mediaType.includes("/")
              ? part.mediaType
              : parsed.mime
          return { ...part, image: parsed.bytes, mediaType }
        }
      }
      if (part.type === "file" && typeof part.data === "string" && part.data.startsWith("data:")) {
        const parsed = parseDataUrl(part.data)
        if (parsed) {
          changed = true
          const mediaType =
            typeof part.mediaType === "string" && part.mediaType.includes("/")
              ? part.mediaType
              : parsed.mime
          return { ...part, data: parsed.bytes, mediaType }
        }
      }
      return part
    })
    return changed ? ({ ...m, content } as ModelMessage) : m
  })
}

// ---------------------------------------------------------------------------
// Pi-style image resize — downscale oversized attachments before they hit the
// wire. Mirrors Pi's image-process limits (max 2000×2000, base64 ≤ ~4.5 MB).
// Decode/encode needs a canvas, so the default engine only works in the
// renderer; tests inject a fake engine.
// ---------------------------------------------------------------------------

export const RESIZE_MAX_DIMENSION = 2000
export const RESIZE_MAX_BASE64_LENGTH = 4_500_000

export interface ResizeOptions {
  maxDimension?: number
  maxBase64Length?: number
}

export interface ResizedImage {
  dataUrl: string
  /** Effective media type of the re-encoded image (PNG → JPEG when compressed). */
  mediaType: string
}

export interface ImageResizeEngine {
  /** Decode, downscale and re-encode. May return the input unchanged when it
   *  is already within limits. Throws on undecodable input. */
  resize(dataUrl: string, opts: Required<ResizeOptions>): Promise<ResizedImage>
}

function hasAlphaMime(mime: string): boolean {
  return /png|webp|gif|tiff|bmp/.test(mime.toLowerCase())
}

function isJpegMime(mime: string): boolean {
  const m = mime.toLowerCase()
  return m === "image/jpeg" || m === "image/jpg"
}

function encodeToDataUrl(
  source: CanvasImageSource,
  w: number,
  h: number,
  mime: "image/jpeg" | "image/png",
  alpha: boolean,
  quality?: number,
): string {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
  if (!alpha) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(source, 0, 0, w, h)
  return canvas.toDataURL(mime, quality)
}

/**
 * CSP-safe decode: never `fetch(data:…)` — Tauri CSP `connect-src` blocks `data:`,
 * which would make every resize silently fall back to the original. Same pattern
 * as `image-store.dataUrlToBytes` / attach-time `createImageBitmap(blob)`.
 */
async function decodeImage(
  dataUrl: string,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) throw new Error("image decode failed: not a data URL")

  if (typeof createImageBitmap === "function") {
    const blob = new Blob([parsed.bytes as BlobPart], { type: parsed.mime || "application/octet-stream" })
    const bmp = await createImageBitmap(blob)
    return { source: bmp, width: bmp.width, height: bmp.height }
  }

  // Fallback for webviews without createImageBitmap — `img-src data:` is allowed.
  if (typeof Image === "undefined") throw new Error("image decode failed: no decoder")
  const img = new Image()
  img.decoding = "async"
  img.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("image decode failed"))
  })
  return { source: img, width: img.naturalWidth, height: img.naturalHeight }
}

function closeSource(source: CanvasImageSource): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close()
}

// LRU-ish cache: history images are immutable, so repeated prepareStep / turn
// calls must not re-decode+encode the same multi-MB screenshot on the main thread.
const RESIZE_CACHE_MAX = 32
const resizeResultCache = new Map<string, ResizedImage>()

function resizeCacheKey(dataUrl: string, maxDim: number, maxB64: number): string {
  // Full data URL as key is fine — the string is already resident in message history.
  // Cap memory by evicting oldest entries below.
  return `${maxDim}|${maxB64}|${dataUrl}`
}

function cacheGet(key: string): ResizedImage | undefined {
  const hit = resizeResultCache.get(key)
  if (!hit) return undefined
  // Refresh insertion order (simple LRU).
  resizeResultCache.delete(key)
  resizeResultCache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: ResizedImage): void {
  if (resizeResultCache.has(key)) resizeResultCache.delete(key)
  resizeResultCache.set(key, value)
  while (resizeResultCache.size > RESIZE_CACHE_MAX) {
    const oldest = resizeResultCache.keys().next().value
    if (oldest === undefined) break
    resizeResultCache.delete(oldest)
  }
}

/** Test helper — clears the in-memory resize cache. */
export function clearResizeCache(): void {
  resizeResultCache.clear()
}

/** Downscale one data-URL image to fit `maxDimension` and `maxBase64Length`. */
export async function resizeDataUrl(
  dataUrl: string,
  opts?: ResizeOptions,
): Promise<ResizedImage> {
  const maxDim = opts?.maxDimension ?? RESIZE_MAX_DIMENSION
  const maxB64 = opts?.maxBase64Length ?? RESIZE_MAX_BASE64_LENGTH
  const cacheKey = resizeCacheKey(dataUrl, maxDim, maxB64)
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const origMime = parseDataUrl(dataUrl)?.mime ?? "image/png"
  const { source, width, height } = await decodeImage(dataUrl)
  try {
    const scale = Math.min(1, maxDim / Math.max(width, height, 1))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    // Already within both limits — keep the original bytes untouched (no
    // re-encode quality loss) and let materializeInlineImages do the work.
    if (scale >= 1 && dataUrlBase64Length(dataUrl) <= maxB64) {
      const passthrough = { dataUrl, mediaType: origMime }
      cacheSet(cacheKey, passthrough)
      return passthrough
    }

    const alpha = hasAlphaMime(origMime)
    let result: ResizedImage | null = null
    if (isJpegMime(origMime)) {
      for (const q of [0.85, 0.7, 0.5, 0.35]) {
        const out = encodeToDataUrl(source, w, h, "image/jpeg", false, q)
        if (dataUrlBase64Length(out) <= maxB64) {
          result = { dataUrl: out, mediaType: "image/jpeg" }
          break
        }
      }
    } else {
      const png = encodeToDataUrl(source, w, h, "image/png", alpha)
      if (dataUrlBase64Length(png) <= maxB64) {
        result = { dataUrl: png, mediaType: "image/png" }
      }
    }
    if (!result) result = shrinkUntilFits(source, w, h, maxB64, width, height)

    cacheSet(cacheKey, result)
    return result
  } finally {
    closeSource(source)
  }
}

function shrinkUntilFits(
  source: CanvasImageSource,
  startW: number,
  startH: number,
  maxB64: number,
  origW: number,
  origH: number,
): ResizedImage {
  let cw = startW
  let ch = startH
  for (let i = 0; i < 8 && cw > 128 && ch > 128; i++) {
    cw = Math.max(128, Math.round(cw * 0.7))
    ch = Math.max(128, Math.round(ch * 0.7))
    const out = encodeToDataUrl(source, cw, ch, "image/jpeg", false, 0.5)
    if (dataUrlBase64Length(out) <= maxB64) return { dataUrl: out, mediaType: "image/jpeg" }
  }
  // Absolute last resort: fit a 256px box at q0.5. Clamp scale ≤ 1 so we never
  // upscale an already-tiny image.
  const s = Math.min(1, 256 / Math.max(origW, origH, 1))
  const lw = Math.max(1, Math.round(origW * s))
  const lh = Math.max(1, Math.round(origH * s))
  return {
    dataUrl: encodeToDataUrl(source, lw, lh, "image/jpeg", false, 0.5),
    mediaType: "image/jpeg",
  }
}

/** Default engine used in the renderer. */
export const canvasResizeEngine: ImageResizeEngine = {
  async resize(dataUrl, opts) {
    return resizeDataUrl(dataUrl, opts)
  },
}

const RESIZE_FAILED_MARKER = "[image omitted — resize failed]"

function isImageFilePart(part: AnyPart): boolean {
  return (
    part.type === "file" &&
    typeof part.mediaType === "string" &&
    part.mediaType.toLowerCase().startsWith("image/") &&
    typeof part.data === "string" &&
    part.data.startsWith("data:")
  )
}

/**
 * Downscale every inline image/file-image part in the outgoing history.
 * Idempotent (already-small images are returned unchanged). On resize failure:
 * keep the original only when it already fits the base64 budget; otherwise
 * replace with a text marker so we never re-send the multi-MB payload that
 * caused DashScope timeouts in the first place.
 */
export async function resizeInlineImages(
  msgs: ModelMessage[],
  opts?: ResizeOptions & { engine?: ImageResizeEngine },
): Promise<ModelMessage[]> {
  const engine = opts?.engine ?? canvasResizeEngine
  const effOpts: Required<ResizeOptions> = {
    maxDimension: opts?.maxDimension ?? RESIZE_MAX_DIMENSION,
    maxBase64Length: opts?.maxBase64Length ?? RESIZE_MAX_BASE64_LENGTH,
  }
  let changed = false
  const out = msgs.slice()
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (!Array.isArray(m.content)) continue
    let msgChanged = false
    const content = (m.content as AnyPart[]).slice()
    for (let j = 0; j < content.length; j++) {
      const part = content[j]!
      let dataUrl: string | null = null
      let kind: "image" | "file" | null = null
      if (part.type === "image" && typeof part.image === "string") {
        dataUrl = part.image
        kind = "image"
      } else if (isImageFilePart(part)) {
        dataUrl = part.data as string
        kind = "file"
      }
      if (!dataUrl || !dataUrl.startsWith("data:") || !kind) continue

      let resized: ResizedImage
      try {
        resized = await engine.resize(dataUrl, effOpts)
      } catch (err) {
        console.warn(`[images] resize failed: ${err}`)
        // Oversized original must not go on the wire — that is the timeout path.
        if (dataUrlBase64Length(dataUrl) > effOpts.maxBase64Length) {
          msgChanged = true
          content[j] = { type: "text", text: RESIZE_FAILED_MARKER }
        }
        continue
      }
      if (resized.dataUrl !== dataUrl) {
        msgChanged = true
        content[j] =
          kind === "image"
            ? { ...part, image: resized.dataUrl, mediaType: resized.mediaType }
            : { ...part, data: resized.dataUrl, mediaType: resized.mediaType }
      }
    }
    if (msgChanged) {
      out[i] = { ...m, content } as ModelMessage
      changed = true
    }
  }
  return changed ? out : msgs
}

const STALE_IMAGE_MARKER = "[image removed — only recent attachments are kept]"

function isImagePart(part: AnyPart): boolean {
  if (part.type === "image") return true
  return part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/")
}

function partIsAlreadyMarker(part: AnyPart): boolean {
  return part.type === "text" && typeof part.text === "string" && part.text.includes("[image removed")
}

/**
 * Tool-loop screenshots are injected as synthetic user turns whose first text
 * part is `browser_screenshot:`. They must not consume the prune keep-window —
 * otherwise 2 screenshots push the user's real attachment out of protection.
 */
export function isScreenshotUserTurn(m: ModelMessage): boolean {
  if (m.role !== "user") return false
  if (!Array.isArray(m.content)) {
    return typeof m.content === "string" && m.content.startsWith("browser_screenshot:")
  }
  for (const p of m.content as unknown as AnyPart[]) {
    if (p.type === "text" && typeof p.text === "string") {
      return p.text.startsWith("browser_screenshot:")
    }
  }
  return false
}

// Drop image/file-image parts from older user turns so every subsequent request
// does not re-upload multi-MB screenshots. DashScope (and similar gateways)
// re-process every image_url on each call and eventually 400 with
// "Download multimodal file timed out" once history accumulates.
//
// Two independent windows:
//  - `keepRecentUserTurns` (default 1): last N *real* user messages keep images.
//    Synthetic `browser_screenshot:` turns never consume this budget — otherwise
//    two tool-loop captures would push the user's attachment out of protection.
//  - `keepRecentScreenshotTurns` (default 2): last N screenshot turns keep
//    images; older captures are stripped even when they sit after a protected
//    real user turn (long tool loops).
//
// Idempotent. Does not touch the UI message list (thumbnails live on
// Message.images); only the model wire/history.
export function pruneStaleImages(
  msgs: ModelMessage[],
  opts?: { keepRecentUserTurns?: number; keepRecentScreenshotTurns?: number },
): { messages: ModelMessage[]; stripped: number } {
  const keepUsers = Math.max(0, opts?.keepRecentUserTurns ?? 1)
  const keepShots = Math.max(0, opts?.keepRecentScreenshotTurns ?? 2)

  const realUserIdx: number[] = []
  const shotIdx: number[] = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (m.role !== "user") continue
    if (isScreenshotUserTurn(m)) shotIdx.push(i)
    else realUserIdx.push(i)
  }

  // Indices at/after which images stay. keep=0 → strip all of that class.
  const protectUsersFrom =
    keepUsers === 0
      ? msgs.length
      : realUserIdx.length > keepUsers
        ? realUserIdx[realUserIdx.length - keepUsers]!
        : 0
  const protectShotsFrom =
    keepShots === 0
      ? msgs.length
      : shotIdx.length > keepShots
        ? shotIdx[shotIdx.length - keepShots]!
        : 0

  // Fast path: nothing can be stripped.
  if (protectUsersFrom === 0 && protectShotsFrom === 0) {
    return { messages: msgs, stripped: 0 }
  }

  let stripped = 0
  let changed = false
  const out = msgs.slice()

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (!Array.isArray(m.content)) continue

    const isShot = isScreenshotUserTurn(m)
    // Screenshot turns use the screenshot window; everything else with images
    // (real user attachments, rare assistant images) uses the user window.
    const shouldStrip = isShot ? i < protectShotsFrom : i < protectUsersFrom
    if (!shouldStrip) continue

    const content = m.content as AnyPart[]
    let msgChanged = false
    let msgStripped = 0
    const newContent: AnyPart[] = []
    for (const p of content) {
      if (isImagePart(p)) {
        msgStripped++
        msgChanged = true
        continue
      }
      newContent.push(p)
    }
    if (!msgChanged) continue
    stripped += msgStripped
    // Ensure the turn still has something the model can read.
    const hasText = newContent.some(
      (p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0,
    )
    const hasMarker = newContent.some(partIsAlreadyMarker)
    if (!hasMarker) {
      if (!hasText) newContent.unshift({ type: "text", text: STALE_IMAGE_MARKER })
      else newContent.push({ type: "text", text: STALE_IMAGE_MARKER })
    }
    // Collapse to plain string when only a single text part remains.
    const onlyText =
      newContent.length === 1 && newContent[0]!.type === "text" && typeof newContent[0]!.text === "string"
        ? (newContent[0]!.text as string)
        : null
    out[i] = (
      onlyText != null ? { ...m, content: onlyText } : { ...m, content: newContent }
    ) as ModelMessage
    changed = true
  }

  return { messages: changed ? out : msgs, stripped }
}
