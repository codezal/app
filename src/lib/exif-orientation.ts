// EXIF orientation reader — pure JS, no dependencies.
//
// Extracts the orientation tag (1..8) from JPEG (APP1/Exif segment) and WebP
// (RIFF EXIF chunk) byte payloads so the renderer can pixel-correct rotated
// photos before they are re-encoded for the wire. Ported from pi's
// exif-orientation.ts with the Photon dependency removed — this module only
// parses bytes, so it runs in Node (unit tests) and the renderer alike.

/** Orientation tag values 1..8 (TIFF orientation semantics). 1 = no transform. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

// "Exif\0\0" marker that precedes the TIFF header inside APP1 / WebP EXIF chunks.
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // E x i f \0 \0

function hasExifHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + 6 > bytes.length) return false
  for (let i = 0; i < 6; i++) {
    if (bytes[offset + i] !== EXIF_HEADER[i]) return false
  }
  return true
}

function readUint16(bytes: Uint8Array, pos: number, le: boolean): number {
  if (le) return bytes[pos]! | (bytes[pos + 1]! << 8)
  return (bytes[pos]! << 8) | bytes[pos + 1]!
}

function readUint32(bytes: Uint8Array, pos: number, le: boolean): number {
  if (le) return bytes[pos]! | (bytes[pos + 1]! << 8) | (bytes[pos + 2]! << 16) | (bytes[pos + 3]! << 24)
  return ((bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!) >>> 0
}

// Parse the TIFF block starting at `tiffStart`. Tag 0x0112 (Orientation) lives
// in the first IFD; anything missing/malformed yields the identity transform.
function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number): ExifOrientation {
  if (tiffStart + 8 > bytes.length) return 1

  const byteOrder = (bytes[tiffStart]! << 8) | bytes[tiffStart + 1]!
  const le = byteOrder === 0x4949 // "II" little-endian
  if (!le && byteOrder !== 0x4d4d) return 1 // "MM" big-endian; otherwise bogus

  const ifdOffset = readUint32(bytes, tiffStart + 4, le)
  const ifdStart = tiffStart + ifdOffset
  if (ifdStart + 2 > bytes.length) return 1

  const entryCount = readUint16(bytes, ifdStart, le)
  for (let i = 0; i < entryCount; i++) {
    const entryPos = ifdStart + 2 + i * 12
    if (entryPos + 12 > bytes.length) return 1

    // Tag id 0x0112 = Orientation. The value fits in the 4-byte value field
    // (offset 8 within the entry) for SHORT types.
    if (readUint16(bytes, entryPos, le) === 0x0112) {
      const value = readUint16(bytes, entryPos + 8, le)
      return (value >= 1 && value <= 8 ? value : 1) as ExifOrientation
    }
  }

  return 1
}

// Scan JPEG segments for the APP1 (0xE1) Exif block. Returns the TIFF start.
function findJpegTiffOffset(bytes: Uint8Array): number {
  let offset = 2 // skip SOI (FF D8)
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) return -1
    const marker = bytes[offset + 1]!
    if (marker === 0xff) {
      offset++
      continue
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    if (marker === 0xe1) {
      if (offset + 4 >= bytes.length) return -1
      const segmentStart = offset + 4
      if (segmentStart + 6 > bytes.length) return -1
      if (!hasExifHeader(bytes, segmentStart)) return -1
      return segmentStart + 6
    }

    if (offset + 4 > bytes.length) return -1
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return -1
    offset += 2 + length
  }
  return -1
}

// Walk RIFF chunks looking for an EXIF chunk. Returns the TIFF start (skipping
// an optional "Exif\0\0" prefix some encoders add inside the chunk payload).
function findWebpTiffOffset(bytes: Uint8Array): number {
  let offset = 12 // skip "RIFF" + size + "WEBP"
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const chunkSize =
      bytes[offset + 4]! | (bytes[offset + 5]! << 8) | (bytes[offset + 6]! << 16) | (bytes[offset + 7]! << 24)
    const dataStart = offset + 8

    if (chunkId === "EXIF") {
      if (dataStart + chunkSize > bytes.length) return -1
      const tiffStart = chunkSize >= 6 && hasExifHeader(bytes, dataStart) ? dataStart + 6 : dataStart
      return tiffStart
    }

    // RIFF chunks are padded to an even size.
    offset = dataStart + chunkSize + (chunkSize % 2)
  }
  return -1
}

/**
 * Read the EXIF orientation (1..8) from a JPEG or WebP byte payload.
 * Returns 1 (identity) for anything else — missing EXIF, unsupported format,
 * or malformed data. Safe to call with arbitrary bytes; never throws.
 */
export function readExifOrientation(bytes: Uint8Array): ExifOrientation {
  if (bytes.length < 12) return 1

  let tiffOffset = -1
  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    tiffOffset = findJpegTiffOffset(bytes)
  }
  // WebP: RIFF....WEBP
  else if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    tiffOffset = findWebpTiffOffset(bytes)
  }

  if (tiffOffset === -1) return 1
  return readOrientationFromTiff(bytes, tiffOffset)
}

/**
 * Pixel-correct an EXIF orientation (2..8) by re-drawing the raw bitmap onto a
 * canvas with the matching affine transform. Returns null when canvas 2D is
 * unavailable. Orientation 1 (identity) is handled by callers. Renderer-only:
 * needs `document`, so it never runs in Node unit tests.
 */
export async function applyExifTransform(bmp: ImageBitmap, orientation: number): Promise<ImageBitmap | null> {
  if (typeof document === "undefined") return null
  const w = bmp.width
  const h = bmp.height
  const canvas = document.createElement("canvas")
  // Rotations (5-8) swap width/height.
  const rotated = orientation >= 5
  canvas.width = rotated ? h : w
  canvas.height = rotated ? w : h
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.save()
  switch (orientation) {
    case 2: // flip horizontal
      ctx.translate(w, 0)
      ctx.scale(-1, 1)
      break
    case 3: // rotate 180
      ctx.translate(w, h)
      ctx.rotate(Math.PI)
      break
    case 4: // flip vertical
      ctx.translate(0, h)
      ctx.scale(1, -1)
      break
    case 5: // transpose + flip horizontal
      ctx.translate(h, 0)
      ctx.rotate(Math.PI / 2)
      ctx.scale(-1, 1)
      break
    case 6: // rotate 90 CW
      ctx.translate(h, 0)
      ctx.rotate(Math.PI / 2)
      break
    case 7: // transpose + flip vertical
      ctx.translate(0, w)
      ctx.rotate(-Math.PI / 2)
      ctx.scale(-1, 1)
      break
    case 8: // rotate 270 CW
      ctx.translate(0, w)
      ctx.rotate(-Math.PI / 2)
      break
    default:
      ctx.restore()
      return null
  }
  ctx.drawImage(bmp, 0, 0)
  ctx.restore()
  try {
    return await createImageBitmap(canvas)
  } catch {
    return null
  }
}
