import { describe, it, expect } from "vitest"
import { wordDiff, annotateIntraline, type DiffLine } from "@/lib/diff"

describe("wordDiff", () => {
  it("yalnız değişen token'ı işaretler, ortak kısmı korur", () => {
    const { del, add } = wordDiff("const x = 1", "const x = 2")
    expect(del.map((s) => s.text).join("")).toBe("const x = 1")
    expect(add.map((s) => s.text).join("")).toBe("const x = 2")
    expect(del.filter((s) => s.changed).map((s) => s.text)).toEqual(["1"])
    expect(add.filter((s) => s.changed).map((s) => s.text)).toEqual(["2"])
    expect(del.find((s) => !s.changed)?.text).toBe("const x = ")
  })

  it("tamamen farklı satırlarda her token değişir", () => {
    const { del, add } = wordDiff("foo", "bar")
    expect(del.every((s) => s.changed)).toBe(true)
    expect(add.every((s) => s.changed)).toBe(true)
  })
})

describe("annotateIntraline", () => {
  const mk = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, text })

  it("benzer del/add çiftine kelime segmenti iliştirir", () => {
    const out = annotateIntraline([mk("del", "let a = 1"), mk("add", "let a = 2")])
    expect(out[0].segs).toBeDefined()
    expect(out[1].segs).toBeDefined()
    expect(out[0].segs!.filter((s) => s.changed).map((s) => s.text)).toEqual(["1"])
  })

  it("benzerlik düşükse segment eklemez (tam-satır değişim)", () => {
    const out = annotateIntraline([
      mk("del", "completely different old line"),
      mk("add", "x"),
    ])
    expect(out[0].segs).toBeUndefined()
    expect(out[1].segs).toBeUndefined()
  })

  it("eşit olmayan blok boyutlarında eşleme yapmaz", () => {
    const out = annotateIntraline([
      mk("del", "a = 1"),
      mk("add", "a = 1"),
      mk("add", "b = 2"),
    ])
    expect(out.every((l) => l.segs === undefined)).toBe(true)
  })

  it("ctx satırlarına dokunmaz ve kopya döner", () => {
    const input = [mk("ctx", "unchanged")]
    const out = annotateIntraline(input)
    expect(out[0].segs).toBeUndefined()
    expect(out).not.toBe(input)
  })

  it("çok satırlı eşit blokları sırayla eşler", () => {
    const out = annotateIntraline([
      mk("del", "x = 1"),
      mk("del", "y = 3"),
      mk("add", "x = 2"),
      mk("add", "y = 4"),
    ])
    expect(out[0].segs!.filter((s) => s.changed).map((s) => s.text)).toEqual(["1"])
    expect(out[1].segs!.filter((s) => s.changed).map((s) => s.text)).toEqual(["3"])
  })
})
