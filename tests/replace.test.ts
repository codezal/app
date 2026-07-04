import { describe, it, expect } from "vitest"
import { replace } from "@/lib/tools/replace"


describe("replace — tam eşleşme", () => {
  it("birebir eşleşmeyi değiştirir", () => {
    expect(replace("const x = 1", "x = 1", "x = 2")).toBe("const x = 2")
  })

  it("old === new → hata", () => {
    expect(() => replace("abc", "a", "a")).toThrow(/aynı/)
  })

  it("bulunamadı → hata", () => {
    expect(() => replace("abc", "xyz", "q")).toThrow(/bulunamadı/)
  })

  it("replace_all olmadan çoklu eşleşme → hata", () => {
    expect(() => replace("x x", "x", "Y")).toThrow(/birden fazla/)
  })
})

// ─── fallback replacer'lar ────────────────────────────────────────────────────

describe("replace — fallback eşleştirme", () => {
  it("satır-trim: girinti uyuşmazlığını tolere eder", () => {
    const content = "if (x) {\n    doThing()\n}"
    const find = "if (x) {\ndoThing()\n}"
    expect(replace(content, find, "DONE")).toBe("DONE")
  })

  it("whitespace-normalize: fazla iç boşlukları tolere eder", () => {
    expect(replace("const   a   =   1", "const a = 1", "X")).toBe("X")
  })
})


describe("replace — aşırı-geniş blok koruması", () => {
  it("block-anchor: orantısız büyük bloğu eşleştirmez (maxLineDelta)", () => {
    const content = [
      "function foo() {",
      "  a()",
      "  b()",
      "  c()",
      "  d()",
      "  e()",
      "  f()",
      "}",
    ].join("\n")
    const find = "function foo() {\n  ONLY_THIS\n}"
    expect(() => replace(content, find, "X")).toThrow(/bulunamadı/)
  })
})

// ─── replace_all ──────────────────────────────────────────────────────────────

describe("replace — replace_all", () => {
  it("tüm geçişleri değiştirir (rename)", () => {
    expect(replace("a x a x a", "x", "Y", true)).toBe("a Y a Y a")
  })

  it("tek geçiş varsa da çalışır", () => {
    expect(replace("foo", "foo", "bar", true)).toBe("bar")
  })
})
