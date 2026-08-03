import { describe, it, expect } from "vitest"
import { uriToPath, uriMatchesPath } from "@/lib/uri"

describe("uriToPath", () => {
  it("posix file:// URI → path", () => {
    expect(uriToPath("file:///Users/me/a.ts")).toBe("/Users/me/a.ts")
  })

  it("Windows file:///C:/ → C:/", () => {
    expect(uriToPath("file:///C:/Users/me/a.ts")).toBe("C:/Users/me/a.ts")
  })

  it("yüzde-kodlamasını çözer", () => {
    expect(uriToPath("file:///Users/me/a%20b.ts")).toBe("/Users/me/a b.ts")
  })

  it("URI olmayan değeri olduğu gibi döner", () => {
    expect(uriToPath("/plain/path.ts")).toBe("/plain/path.ts")
  })

  it("UNC share host'u korunur (M33)", () => {
    expect(uriToPath("file://server/share/f.ts")).toBe("//server/share/f.ts")
  })

  it("localhost authority → local path", () => {
    expect(uriToPath("file://localhost/Users/me/a.ts")).toBe("/Users/me/a.ts")
  })

  it("UNC encoded path çözülür", () => {
    expect(uriToPath("file://server/share/a%20b.ts")).toBe("//server/share/a b.ts")
  })
})

describe("uriMatchesPath", () => {
  it("aynı posix dosya → true", () => {
    expect(uriMatchesPath("file:///Users/me/a.ts", "/Users/me/a.ts")).toBe(true)
  })

  it("farklı dosya → false", () => {
    expect(uriMatchesPath("file:///Users/me/a.ts", "/Users/me/b.ts")).toBe(false)
  })

  it("Windows ters slash + büyük/küçük harf duyarsız", () => {
    expect(uriMatchesPath("file:///C:/Users/Me/A.ts", "C:\\Users\\me\\a.ts")).toBe(true)
  })

  it("kodlanmış URI ile düz path eşleşir", () => {
    expect(uriMatchesPath("file:///Users/me/a%20b.ts", "/Users/me/a b.ts")).toBe(true)
  })

  it("UNC URI ile UNC path eşleşir (case-insensitive host)", () => {
    expect(uriMatchesPath("file://Server/Share/f.ts", "\\\\server\\share\\f.ts")).toBe(true)
    expect(uriMatchesPath("file://server/share/f.ts", "//server/other/f.ts")).toBe(false)
  })
})
