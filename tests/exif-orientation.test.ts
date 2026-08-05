import { describe, it, expect } from "vitest"
import { readExifOrientation } from "@/lib/exif-orientation"

// Build a minimal JPEG SOI + APP1 (Exif) segment + a couple of SOS bytes.
// APP1 payload: "Exif\0\0" + TIFF header + IFD with an Orientation tag.
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const exif = tiffWithOrientation(orientation, littleEndian)
  const app1Payload = new Uint8Array(2 + 6 + exif.length) // "Exif\0\0" prefix
  app1Payload[0] = 0x45 // E
  app1Payload[1] = 0x78 // x
  app1Payload[2] = 0x69 // i
  app1Payload[3] = 0x66 // f
  app1Payload[4] = 0x00
  app1Payload[5] = 0x00
  app1Payload.set(exif, 6)

  // 2 (SOI) + 2 (APP1 len) + payload + 2 (SOS marker) + 2 (EOI)
  const out = new Uint8Array(2 + 2 + app1Payload.length + 2 + 2)
  out[0] = 0xff
  out[1] = 0xd8 // SOI
  out[2] = 0xff
  out[3] = 0xe1 // APP1
  out[4] = ((app1Payload.length + 2) >> 8) & 0xff
  out[5] = (app1Payload.length + 2) & 0xff
  out.set(app1Payload, 6)
  out[6 + app1Payload.length] = 0xff
  out[7 + app1Payload.length] = 0xda // SOS
  out[8 + app1Payload.length] = 0xff
  out[9 + app1Payload.length] = 0xd9 // EOI
  return out
}

// Minimal TIFF: 8-byte header + 1 IFD entry (Orientation, tag 0x0112).
function tiffWithOrientation(orientation: number, littleEndian: boolean): Uint8Array {
  const le = littleEndian
  const buf = new ArrayBuffer(8 + 2 + 12 + 4)
  const b = new Uint8Array(buf)
  b[0] = le ? 0x49 : 0x4d // "II" / "MM"
  b[1] = le ? 0x49 : 0x4d
  b[2] = 42 // magic
  b[3] = 0
  if (!le) {
    b[0] = 0x4d
    b[1] = 0x4d
    b[2] = 0
    b[3] = 42
  }
  // IFD offset = 8 (right after the header)
  const write16 = (pos: number, v: number) => {
    if (le) {
      b[pos] = v & 0xff
      b[pos + 1] = (v >> 8) & 0xff
    } else {
      b[pos] = (v >> 8) & 0xff
      b[pos + 1] = v & 0xff
    }
  }
  const write32 = (pos: number, v: number) => {
    if (le) {
      b[pos] = v & 0xff
      b[pos + 1] = (v >> 8) & 0xff
      b[pos + 2] = (v >> 16) & 0xff
      b[pos + 3] = (v >> 24) & 0xff
    } else {
      b[pos] = (v >> 24) & 0xff
      b[pos + 1] = (v >> 16) & 0xff
      b[pos + 2] = (v >> 8) & 0xff
      b[pos + 3] = v & 0xff
    }
  }
  write32(4, 8) // IFD offset
  write16(8, 1) // entry count = 1
  write16(10, 0x0112) // Orientation tag
  write16(12, 3) // type SHORT
  write32(14, 1) // count
  write16(18, orientation) // value
  write16(20, 0) // pad rest of value field
  write32(22, 0) // next IFD = 0
  return b
}

// Minimal WebP: RIFF header + EXIF chunk containing a TIFF.
function webpWithOrientation(orientation: number): Uint8Array {
  const tiff = tiffWithOrientation(orientation, true)
  const exifPayload = new Uint8Array(6 + tiff.length)
  exifPayload[0] = 0x45 // E
  exifPayload[1] = 0x78 // x
  exifPayload[2] = 0x69 // i
  exifPayload[3] = 0x66 // f
  exifPayload[4] = 0x00
  exifPayload[5] = 0x00
  exifPayload.set(tiff, 6)

  const chunkSize = exifPayload.length
  const out = new Uint8Array(12 + 8 + chunkSize)
  // "RIFF"
  out[0] = 0x52
  out[1] = 0x49
  out[2] = 0x46
  out[3] = 0x46
  // RIFF size (whole file - 8)
  const riffSize = 4 + 8 + chunkSize
  out[4] = riffSize & 0xff
  out[5] = (riffSize >> 8) & 0xff
  out[6] = (riffSize >> 16) & 0xff
  out[7] = (riffSize >> 24) & 0xff
  // "WEBP"
  out[8] = 0x57
  out[9] = 0x45
  out[10] = 0x42
  out[11] = 0x50
  // "EXIF" chunk header
  out[12] = 0x45
  out[13] = 0x58
  out[14] = 0x49
  out[15] = 0x46
  out[16] = chunkSize & 0xff
  out[17] = (chunkSize >> 8) & 0xff
  out[18] = (chunkSize >> 16) & 0xff
  out[19] = (chunkSize >> 24) & 0xff
  out.set(exifPayload, 20)
  return out
}

describe("readExifOrientation", () => {
  it("returns 1 for JPEG without EXIF", () => {
    // SOI + SOS + EOI only
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0xff, 0xd9])
    expect(readExifOrientation(jpeg)).toBe(1)
  })

  it("returns 1 for arbitrary / empty bytes", () => {
    expect(readExifOrientation(new Uint8Array(0))).toBe(1)
    expect(readExifOrientation(new Uint8Array([1, 2, 3]))).toBe(1)
    expect(readExifOrientation(new TextEncoder().encode("hello world plain text"))).toBe(1)
  })

  it("reads orientation 6 from a JPEG (little-endian TIFF)", () => {
    expect(readExifOrientation(jpegWithOrientation(6))).toBe(6)
  })

  it("reads orientation 3 from a JPEG (little-endian TIFF)", () => {
    expect(readExifOrientation(jpegWithOrientation(3))).toBe(3)
  })

  it("reads orientation from a big-endian TIFF JPEG", () => {
    expect(readExifOrientation(jpegWithOrientation(8, false))).toBe(8)
  })

  it("reads orientation 6 from a WebP EXIF chunk", () => {
    expect(readExifOrientation(webpWithOrientation(6))).toBe(6)
  })

  it("clamps out-of-range orientation values to 1", () => {
    expect(readExifOrientation(jpegWithOrientation(9))).toBe(1)
    expect(readExifOrientation(jpegWithOrientation(0))).toBe(1)
  })

  it("skips non-APP1 segments before finding Exif", () => {
    // SOI + APP0 (JFIF) + APP1(Exif). APP0 must be skipped correctly.
    const exif = tiffWithOrientation(6, true)
    const app0Len = 14
    const app1PayloadLen = 6 + exif.length
    const total = 2 + (2 + app0Len) + (2 + app1PayloadLen) + 2 + 2
    const out = new Uint8Array(total)
    out[0] = 0xff
    out[1] = 0xd8
    // APP0
    out[2] = 0xff
    out[3] = 0xe0
    out[4] = 0x00
    out[5] = app0Len
    for (let i = 0; i < app0Len - 2; i++) out[6 + i] = 0x11 // JFIF-ish filler
    // APP1
    out[2 + 2 + app0Len] = 0xff
    out[3 + 2 + app0Len] = 0xe1
    out[4 + 2 + app0Len] = ((app1PayloadLen + 2) >> 8) & 0xff
    out[5 + 2 + app0Len] = (app1PayloadLen + 2) & 0xff
    // "Exif\0\0"
    out[6 + 2 + app0Len] = 0x45
    out[7 + 2 + app0Len] = 0x78
    out[8 + 2 + app0Len] = 0x69
    out[9 + 2 + app0Len] = 0x66
    out[10 + 2 + app0Len] = 0x00
    out[11 + 2 + app0Len] = 0x00
    out.set(exif, 12 + 2 + app0Len)
    expect(readExifOrientation(out)).toBe(6)
  })

  it("handles truncated payloads without throwing", () => {
    const jpeg = jpegWithOrientation(6)
    const truncated = jpeg.slice(0, 10)
    expect(() => readExifOrientation(truncated)).not.toThrow()
    expect(readExifOrientation(truncated)).toBe(1)
  })
})
