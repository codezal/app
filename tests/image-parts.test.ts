import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ModelMessage } from "ai"
import {
  materializeInlineImages,
  parseDataUrl,
  base64ToUint8Array,
  pruneStaleImages,
  resizeInlineImages,
  clearResizeCache,
  dataUrlBase64Length,
  isScreenshotUserTurn,
} from "@/lib/image-parts"
import type { ImageResizeEngine } from "@/lib/image-parts"

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG_DATA = `data:image/png;base64,${PNG_B64}`

beforeEach(() => {
  clearResizeCache()
})

describe("parseDataUrl", () => {
  it("png data URL → bytes + mime", () => {
    const r = parseDataUrl(PNG_DATA)
    expect(r).not.toBeNull()
    expect(r!.mime).toBe("image/png")
    expect(r!.bytes).toBeInstanceOf(Uint8Array)
    expect(r!.bytes.length).toBeGreaterThan(0)
    expect(Array.from(r!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
  it("http URL → null", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull()
  })
})

describe("base64ToUint8Array", () => {
  it("roundtrip length", () => {
    const bytes = base64ToUint8Array(PNG_B64)
    expect(bytes.length).toBeGreaterThan(0)
  })
})

describe("dataUrlBase64Length", () => {
  it("returns payload length excluding the data: header", () => {
    expect(dataUrlBase64Length(PNG_DATA)).toBe(PNG_B64.length)
    expect(dataUrlBase64Length(PNG_DATA)).toBeLessThan(PNG_DATA.length)
  })
})

describe("materializeInlineImages", () => {
  it("data URL image → Uint8Array + mediaType", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "ne var?" },
          { type: "image", image: PNG_DATA, mediaType: "image/png" },
        ],
      },
    ]
    const out = materializeInlineImages(msgs)
    const part = (out[0].content as Array<Record<string, unknown>>)[1]
    expect(part.type).toBe("image")
    expect(part.image).toBeInstanceOf(Uint8Array)
    expect(part.mediaType).toBe("image/png")
    // History source unchanged (immutability)
    expect((msgs[0].content as Array<Record<string, unknown>>)[1].image).toBe(PNG_DATA)
  })
  it("http image URL untouched", () => {
    const url = "https://example.com/a.png"
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: url, mediaType: "image/png" }],
      },
    ]
    const out = materializeInlineImages(msgs)
    const part = (out[0].content as Array<Record<string, unknown>>)[0]
    expect(part.image).toBe(url)
  })
  it("plain text messages unchanged", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }]
    expect(materializeInlineImages(msgs)).toEqual(msgs)
  })
})

describe("isScreenshotUserTurn", () => {
  it("detects array content starting with browser_screenshot:", () => {
    const m: ModelMessage = {
      role: "user",
      content: [
        { type: "text", text: "browser_screenshot:" },
        { type: "image", image: PNG_DATA, mediaType: "image/png" },
      ],
    }
    expect(isScreenshotUserTurn(m)).toBe(true)
  })
  it("detects plain string content", () => {
    expect(isScreenshotUserTurn({ role: "user", content: "browser_screenshot: done" })).toBe(true)
  })
  it("rejects normal user turns", () => {
    expect(
      isScreenshotUserTurn({
        role: "user",
        content: [{ type: "text", text: "bu ekrandaki hatayı düzelt" }, { type: "image", image: PNG_DATA }],
      }),
    ).toBe(false)
  })
})

describe("pruneStaleImages", () => {
  const imgPart = { type: "image" as const, image: PNG_DATA, mediaType: "image/png" }

  it("keeps only the latest user turn images (default keep=1)", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "eski ekran" },
          imgPart,
        ],
      },
      { role: "assistant", content: "gördüm" },
      {
        role: "user",
        content: [
          { type: "text", text: "yeni soru" },
          imgPart,
        ],
      },
    ]
    const { messages, stripped } = pruneStaleImages(msgs)
    expect(stripped).toBe(1)
    const old = messages[0]!.content
    // Old turn: image gone, marker present, text kept.
    if (typeof old === "string") {
      expect(old).toContain("eski ekran")
      expect(old).toContain("[image removed")
    } else {
      const parts = old as Array<Record<string, unknown>>
      expect(parts.some((p) => p.type === "image")).toBe(false)
      expect(parts.some((p) => p.type === "text" && String(p.text).includes("eski ekran"))).toBe(true)
      expect(parts.some((p) => p.type === "text" && String(p.text).includes("[image removed"))).toBe(
        true,
      )
    }
    // Latest user turn still has the image.
    const latest = messages[2]!.content as Array<Record<string, unknown>>
    expect(latest.some((p) => p.type === "image")).toBe(true)
    // Source immutable.
    expect((msgs[0]!.content as Array<Record<string, unknown>>).some((p) => p.type === "image")).toBe(
      true,
    )
  })

  it("no-op when only one user turn", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "tek" }, imgPart],
      },
    ]
    const r = pruneStaleImages(msgs)
    expect(r.stripped).toBe(0)
    expect(r.messages).toBe(msgs)
  })

  it("keepRecentUserTurns=0 strips every image", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "a" }, imgPart] },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "b" }, imgPart] },
    ]
    const { messages, stripped } = pruneStaleImages(msgs, { keepRecentUserTurns: 0 })
    expect(stripped).toBe(2)
    for (const m of messages) {
      if (!Array.isArray(m.content)) continue
      expect((m.content as Array<Record<string, unknown>>).some((p) => p.type === "image")).toBe(false)
    }
  })

  it("idempotent — second pass strips nothing", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "a" }, imgPart] },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "b" }, imgPart] },
    ]
    const first = pruneStaleImages(msgs)
    const second = pruneStaleImages(first.messages)
    expect(second.stripped).toBe(0)
    expect(second.messages).toBe(first.messages)
  })

  it("image-only old turn becomes marker text", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [imgPart] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "sadece metin" },
    ]
    const { messages, stripped } = pruneStaleImages(msgs)
    expect(stripped).toBe(1)
    expect(messages[0]!.content).toBe("[image removed — only recent attachments are kept]")
  })

  it("screenshot user turns do not consume the real-user keep window", () => {
    // Real user attachment + 2 injected screenshots. Naive counting with keep=2
    // would protect only the last 2 screenshot turns and strip the user's image.
    // Screenshots use a separate budget, so the real attachment stays.
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "bu ekrandaki hatayı düzelt" },
          imgPart,
        ],
      },
      { role: "assistant", content: "bakıyorum" },
      {
        role: "user",
        content: [
          { type: "text", text: "browser_screenshot:" },
          { type: "image", image: PNG_DATA, mediaType: "image/jpeg" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "browser_screenshot:" },
          { type: "image", image: PNG_DATA, mediaType: "image/jpeg" },
        ],
      },
    ]
    const { messages, stripped } = pruneStaleImages(msgs, { keepRecentUserTurns: 2 })
    expect(stripped).toBe(0)
    const userParts = messages[0]!.content as Array<Record<string, unknown>>
    expect(userParts.some((p) => p.type === "image")).toBe(true)
  })

  it("strips images from old real turns even when screenshots follow", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "eski" }, imgPart] },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "yeni" }, imgPart] },
      {
        role: "user",
        content: [
          { type: "text", text: "browser_screenshot:" },
          { type: "image", image: PNG_DATA, mediaType: "image/jpeg" },
        ],
      },
    ]
    // keepUsers=1 → only the latest REAL user turn ("yeni") is protected. Old
    // "eski" is stripped. The trailing screenshot stays (within shot window).
    const { messages, stripped } = pruneStaleImages(msgs, { keepRecentUserTurns: 1 })
    expect(stripped).toBe(1)
    const old = messages[0]!.content
    if (typeof old === "string") {
      expect(old).toContain("[image removed")
    } else {
      expect((old as Array<Record<string, unknown>>).some((p) => p.type === "image")).toBe(false)
    }
    const latest = messages[2]!.content as Array<Record<string, unknown>>
    expect(latest.some((p) => p.type === "image")).toBe(true)
    const shot = messages[3]!.content as Array<Record<string, unknown>>
    expect(shot.some((p) => p.type === "image")).toBe(true)
  })

  it("keeps only the last N screenshot turns (tool-loop accumulation)", () => {
    const shot = (n: number): ModelMessage => ({
      role: "user",
      content: [
        { type: "text", text: "browser_screenshot:" },
        { type: "image", image: `data:image/jpeg;base64,shot${n}`, mediaType: "image/jpeg" },
      ],
    })
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "fix" }, imgPart] },
      shot(1),
      shot(2),
      shot(3),
    ]
    const { messages, stripped } = pruneStaleImages(msgs, {
      keepRecentUserTurns: 1,
      keepRecentScreenshotTurns: 2,
    })
    // shot1 stripped; shot2+shot3 kept; user attachment kept.
    expect(stripped).toBe(1)
    const s1 = messages[1]!.content
    if (typeof s1 === "string") expect(s1).toContain("[image removed")
    else expect((s1 as Array<Record<string, unknown>>).some((p) => p.type === "image")).toBe(false)
    for (const idx of [2, 3]) {
      const parts = messages[idx]!.content as Array<Record<string, unknown>>
      expect(parts.some((p) => p.type === "image")).toBe(true)
    }
    const userParts = messages[0]!.content as Array<Record<string, unknown>>
    expect(userParts.some((p) => p.type === "image")).toBe(true)
  })
})

describe("resizeInlineImages", () => {
  const BIG = "data:image/png;base64,123456789012345678901234567890"
  const SHRUNK = "data:image/jpeg;base64,resized"
  const SMALL = "data:image/jpeg;base64,ok"
  // Oversized payload so failure fallback must drop it (base64 length > budget).
  const HUGE = `data:image/png;base64,${"A".repeat(5_000_000)}`

  const fakeEngine = (): ImageResizeEngine & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      async resize(dataUrl) {
        calls.push(dataUrl)
        if (dataUrl === BIG || dataUrl === HUGE) return { dataUrl: SHRUNK, mediaType: "image/jpeg" }
        return { dataUrl, mediaType: "image/png" }
      },
    }
  }

  it("downscales data-URL image parts and updates mediaType", async () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "resim" }, { type: "image", image: BIG, mediaType: "image/png" }] },
    ]
    const out = await resizeInlineImages(msgs, { engine: fakeEngine() })
    const parts = out[0]!.content as Array<Record<string, unknown>>
    const img = parts[1]!
    expect(img.image).toBe(SHRUNK)
    expect(img.mediaType).toBe("image/jpeg")
    // Source immutable.
    expect((msgs[0]!.content as Array<Record<string, unknown>>)[1]!.image).toBe(BIG)
  })

  it("resizes file parts whose mediaType is an image", async () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "file", data: BIG, mediaType: "image/png", filename: "a.png" }] },
    ]
    const out = await resizeInlineImages(msgs, { engine: fakeEngine() })
    const part = (out[0]!.content as Array<Record<string, unknown>>)[0]!
    expect(part.data).toBe(SHRUNK)
    expect(part.mediaType).toBe("image/jpeg")
  })

  it("skips non-image file parts (e.g. PDF data URLs)", async () => {
    const pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    const engine = fakeEngine()
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "file", data: pdf, mediaType: "application/pdf", filename: "a.pdf" }] },
    ]
    const out = await resizeInlineImages(msgs, { engine })
    expect(engine.calls).toEqual([])
    expect(out).toBe(msgs)
  })

  it("never calls the engine for http(s) image URLs", async () => {
    const url = "https://example.com/a.png"
    const engine = fakeEngine()
    const msgs: ModelMessage[] = [{ role: "user", content: [{ type: "image", image: url, mediaType: "image/png" }] }]
    const out = await resizeInlineImages(msgs, { engine })
    expect(engine.calls).toEqual([])
    expect(out).toBe(msgs)
  })

  it("returns the same reference when nothing needs resizing", async () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "plain text" }]
    const out = await resizeInlineImages(msgs, { engine: fakeEngine() })
    expect(out).toBe(msgs)
  })

  it("keeps a small original when the engine throws", async () => {
    const engine: ImageResizeEngine = {
      async resize() {
        throw new Error("decode failed")
      },
    }
    const msgs: ModelMessage[] = [{ role: "user", content: [{ type: "image", image: BIG, mediaType: "image/png" }] }]
    const out = await resizeInlineImages(msgs, { engine })
    // BIG is under the default budget → leave original so stream still has something.
    expect(out).toBe(msgs)
  })

  it("replaces an oversized original with a marker when the engine throws", async () => {
    const engine: ImageResizeEngine = {
      async resize() {
        throw new Error("decode failed")
      },
    }
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "image", image: HUGE, mediaType: "image/png" }] },
    ]
    const out = await resizeInlineImages(msgs, { engine })
    const parts = out[0]!.content as Array<Record<string, unknown>>
    expect(parts).toHaveLength(1)
    expect(parts[0]!.type).toBe("text")
    expect(String(parts[0]!.text)).toContain("[image omitted")
    // Must not still contain the multi-MB payload.
    expect(JSON.stringify(out).length).toBeLessThan(HUGE.length)
  })

  it("idempotent — second pass is a no-op once images are already small", async () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "r" }, { type: "image", image: BIG, mediaType: "image/png" }] },
    ]
    const engine = fakeEngine()
    const first = await resizeInlineImages(msgs, { engine })
    const second = await resizeInlineImages(first, { engine })
    expect(second).toBe(first)
    // Engine saw the shrunk URL on the second pass and left it alone.
    expect(engine.calls[1]).toBe(SHRUNK)
  })

  it("passes effective default options to the engine", async () => {
    const engine: ImageResizeEngine = {
      async resize(_dataUrl, _opts) {
        return { dataUrl: SMALL, mediaType: "image/jpeg" }
      },
    }
    const spy = vi.spyOn(engine, "resize")
    const msgs: ModelMessage[] = [{ role: "user", content: [{ type: "image", image: BIG, mediaType: "image/png" }] }]
    await resizeInlineImages(msgs, { engine })
    expect(spy).toHaveBeenCalledWith(BIG, { maxDimension: 2000, maxBase64Length: 4_500_000 })
  })
})
