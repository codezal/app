import { describe, it, expect } from "vitest"
import { compressProse } from "@/lib/token-savers/compress-tools/prose"

describe("compressProse", () => {
  it("filler ve pleasantry düşürür", () => {
    const out = compressProse("Please just run the build, thanks.")
    expect(out).not.toMatch(/\bplease\b/i)
    expect(out).not.toMatch(/\bjust\b/i)
    expect(out).not.toMatch(/\bthanks\b/i)
    expect(out).toMatch(/run/i)
    expect(out).toMatch(/build/i)
  })

  it("article (a/an/the) korunur — anlamsal belirsizlik yaratmamak için", () => {
    const out = compressProse("Read the file and open a folder.")
    expect(out).toMatch(/\bthe\b/i)
    expect(out).toMatch(/\ba\b/i)
  })

  it("hedge (perhaps/maybe/I think) düşürür", () => {
    const out = compressProse("Perhaps you should maybe check it.")
    expect(out).not.toMatch(/\bperhaps\b/i)
    expect(out).not.toMatch(/\bmaybe\b/i)
  })

  it("inline kod korunur", () => {
    const out = compressProse("Use the `the.actually.simply()` helper please.")
    expect(out).toContain("`the.actually.simply()`")
  })

  it("kod bloğu korunur", () => {
    const code = "```\nconst the = just(a, an)\n```"
    const out = compressProse(`Here is code please:\n${code}\nthanks`)
    expect(out).toContain(code)
  })

  it("URL korunur", () => {
    const out = compressProse("See https://example.com/the/actually please.")
    expect(out).toContain("https://example.com/the/actually")
  })

  it("dosya yolu korunur", () => {
    const out = compressProse("Edit src/the/actually-simply.ts now please.")
    expect(out).toContain("src/the/actually-simply.ts")
  })

  it("CONST_CASE identifier korunur", () => {
    const out = compressProse("Set THE_ACTUAL_FLAG to true please.")
    expect(out).toContain("THE_ACTUAL_FLAG")
  })

  it("fonksiyon imzası korunur", () => {
    const out = compressProse("Call buildAllTools(workspace, servers) just once.")
    expect(out).toContain("buildAllTools(workspace, servers)")
  })

  it("semver korunur", () => {
    const out = compressProse("Bump to version 1.2.3 please.")
    expect(out).toContain("1.2.3")
  })

  it("boş/whitespace girişi değiştirmez", () => {
    expect(compressProse("")).toBe("")
    expect(compressProse("   ")).toBe("   ")
  })

  it("kısaltma sonrası yanlış büyütme yapmaz (recapitalize kapalı)", () => {
    const out = compressProse("Use e.g. the helper.")
    expect(out).not.toMatch(/e\.g\.\s+[A-Z]/)
  })

  it("sıkıştırma çıktıyı uzatmaz", () => {
    const input = "Please just really simply read the actual file, thanks."
    expect(compressProse(input).length).toBeLessThan(input.length)
  })
})
