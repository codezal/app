import { describe, it, expect } from "vitest"
import { lineDiff, hunksForEdit } from "@/lib/diff"

describe("lineDiff", () => {
  it("özdeş metinler → tamamı ctx", () => {
    const r = lineDiff("a\nb\nc", "a\nb\nc")
    expect(r.every((l) => l.kind === "ctx")).toBe(true)
    expect(r).toHaveLength(3)
  })

  it("boş → değişim yok (add/del satırı yok)", () => {
    const r = lineDiff("", "")
    expect(r.every((l) => l.kind === "ctx")).toBe(true)
  })

  it("tek satır eklendi", () => {
    const r = lineDiff("", "hello")
    expect(r.some((l) => l.kind === "add" && l.text === "hello")).toBe(true)
  })

  it("tek satır silindi", () => {
    const r = lineDiff("hello", "")
    expect(r.some((l) => l.kind === "del" && l.text === "hello")).toBe(true)
  })

  it("satır değişimi: del + add", () => {
    const r = lineDiff("old", "new")
    expect(r.some((l) => l.kind === "del" && l.text === "old")).toBe(true)
    expect(r.some((l) => l.kind === "add" && l.text === "new")).toBe(true)
  })

  it("çok satır: orta satır değişti", () => {
    const r = lineDiff("a\nb\nc", "a\nX\nc")
    const kinds = r.map((l) => l.kind)
    expect(kinds).toContain("ctx")
    expect(kinds).toContain("del")
    expect(kinds).toContain("add")
    expect(r.find((l) => l.kind === "del")?.text).toBe("b")
    expect(r.find((l) => l.kind === "add")?.text).toBe("X")
  })

  it("sonuna satır eklendi", () => {
    const r = lineDiff("a\nb", "a\nb\nc")
    expect(r.find((l) => l.kind === "add")?.text).toBe("c")
  })

  it("başa satır eklendi", () => {
    const r = lineDiff("b\nc", "a\nb\nc")
    expect(r.find((l) => l.kind === "add")?.text).toBe("a")
  })

  it("ctx satırları doğru oldNo/newNo alır", () => {
    const r = lineDiff("a\nb", "a\nb")
    const a = r.find((l) => l.text === "a")!
    expect(a.oldNo).toBe(1)
    expect(a.newNo).toBe(1)
  })

  it("CRLF satır sonları tolere edilir", () => {
    const r = lineDiff("a\r\nb", "a\r\nb")
    expect(r.every((l) => l.kind === "ctx")).toBe(true)
  })
})

describe("hunksForEdit", () => {
  it("aynı metin → boş dizi", () => {
    expect(hunksForEdit("a\nb", "a\nb")).toEqual([])
  })

  it("bağlam satırları değişim etrafında kısıtlanır (varsayılan 2)", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`)
    const oldText = lines.join("\n")
    const newText = [...lines.slice(0, 4), "CHANGED", ...lines.slice(5)].join("\n")
    const hunks = hunksForEdit(oldText, newText)
    expect(hunks.some((l) => l.kind === "del" && l.text === "line5")).toBe(true)
    expect(hunks.some((l) => l.kind === "add" && l.text === "CHANGED")).toBe(true)
    expect(hunks.find((l) => l.text === "line1")).toBeUndefined()
    expect(hunks.find((l) => l.text === "line2")).toBeUndefined()
  })

  it("… separatörü uzak hunklar arasında eklenir", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)
    lines[1] = "CHANGE_A"
    lines[18] = "CHANGE_B"
    const oldLines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)
    const h = hunksForEdit(oldLines.join("\n"), lines.join("\n"))
    expect(h.some((l) => l.text === "…")).toBe(true)
  })

  it("bağlam penceresi parametresi çalışır", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`)
    const newText = [...lines.slice(0, 4), "CHANGED", ...lines.slice(5)].join("\n")
    const h1 = hunksForEdit(lines.join("\n"), newText, 1)
    const h3 = hunksForEdit(lines.join("\n"), newText, 3)
    const ctxCount = (h: typeof h1) => h.filter((l) => l.kind === "ctx" && l.text !== "…").length
    expect(ctxCount(h3)).toBeGreaterThan(ctxCount(h1))
  })
})
