import { describe, it, expect } from "vitest"
import { extOf, formattersForExt, FORMATTERS } from "@/lib/tools/formatters"

describe("extOf", () => {
  it("normal uzantı", () => expect(extOf("src/main.ts")).toBe(".ts"))
  it("büyük harf → lowercase", () => expect(extOf("A.GO")).toBe(".go"))
  it("çok noktalı → son uzantı", () => expect(extOf("a.test.tsx")).toBe(".tsx"))
  it("uzantısız → boş", () => expect(extOf("Makefile")).toBe(""))
  it("dotfile → boş", () => expect(extOf(".bashrc")).toBe(""))
  it("nested path", () => expect(extOf("a/b/c.py")).toBe(".py"))
  it("windows ayraç", () => expect(extOf("a\\b\\c.rs")).toBe(".rs"))
})

describe("formattersForExt", () => {
  it(".go → gofmt", () =>
    expect(formattersForExt(".go").map((f) => f.name)).toEqual(["gofmt"]))
  it(".rs → rustfmt", () =>
    expect(formattersForExt(".rs").map((f) => f.name)).toEqual(["rustfmt"]))
  it(".py → ruff (sadece — black yok, çift-format önlenir)", () =>
    expect(formattersForExt(".py").map((f) => f.name)).toEqual(["ruff"]))
  it(".sh → shfmt", () =>
    expect(formattersForExt(".sh").map((f) => f.name)).toEqual(["shfmt"]))
  it(".ts → eslint + prettier + biome (çakışma runtime tespitle çözülür)", () =>
    expect(formattersForExt(".ts").map((f) => f.name).sort()).toEqual([
      "biome",
      "eslint",
      "prettier",
    ]))
  it(".css → prettier + biome", () =>
    expect(formattersForExt(".css").map((f) => f.name).sort()).toEqual([
      "biome",
      "prettier",
    ]))
  it("bilinmeyen uzantı → boş", () => expect(formattersForExt(".xyz")).toEqual([]))
  it("boş ext → boş", () => expect(formattersForExt("")).toEqual([]))
})

describe("FORMATTERS registry sanity", () => {
  it("name'ler unique", () => {
    const names = FORMATTERS.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it("her entry non-empty extensions + detect, command'da $FILE var", () => {
    for (const f of FORMATTERS) {
      expect(f.extensions.length).toBeGreaterThan(0)
      expect(f.detect.trim().length).toBeGreaterThan(0)
      expect(f.command).toContain("$FILE")
    }
  })
  it("tüm uzantılar nokta ile başlar + lowercase", () => {
    for (const f of FORMATTERS)
      for (const e of f.extensions) {
        expect(e.startsWith(".")).toBe(true)
        expect(e).toBe(e.toLowerCase())
      }
  })
  it("sadece eslint surfaceOutput=true (lint feedback)", () => {
    const surfacing = FORMATTERS.filter((f) => f.surfaceOutput).map((f) => f.name)
    expect(surfacing).toEqual(["eslint"])
  })
})
