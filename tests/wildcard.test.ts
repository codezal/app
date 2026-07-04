import { describe, it, expect } from "vitest"
import { wildcardMatch, hasGlob } from "@/lib/wildcard"

describe("wildcardMatch", () => {
  it("'*' her şeyle eşleşir", () => {
    expect(wildcardMatch("anything", "*")).toBe(true)
    expect(wildcardMatch("", "*")).toBe(true)
  })

  it("trailing ' *' argümanı opsiyonel yapar", () => {
    expect(wildcardMatch("git", "git *")).toBe(true)
    expect(wildcardMatch("git push", "git *")).toBe(true)
    expect(wildcardMatch("git push origin main", "git *")).toBe(true)
    expect(wildcardMatch("gitx", "git *")).toBe(false)
  })

  it("'?' tek karakter eşler", () => {
    expect(wildcardMatch("cat", "ca?")).toBe(true)
    expect(wildcardMatch("ca", "ca?")).toBe(false)
    expect(wildcardMatch("cats", "ca?")).toBe(false)
  })

  it("glob'suz pattern tam eşleşme ister", () => {
    expect(wildcardMatch("git push", "git push")).toBe(true)
    expect(wildcardMatch("git push origin", "git push")).toBe(false)
  })

  it("regex metakarakterleri literal alınır", () => {
    expect(wildcardMatch("a.b.c", "a.b.c")).toBe(true)
    expect(wildcardMatch("axbxc", "a.b.c")).toBe(false)
    expect(wildcardMatch("price(5)", "price(5)")).toBe(true)
  })

  it("orta * herhangi bir parçayı eşler", () => {
    expect(wildcardMatch("npm run build", "npm run *")).toBe(true)
    expect(wildcardMatch("src/lib/foo.ts", "src/*/foo.ts")).toBe(true)
    expect(wildcardMatch("src/foo.ts", "src/*/foo.ts")).toBe(false)
  })

  it("backslash path'i forward-slash'e normalize eder", () => {
    expect(wildcardMatch("src\\lib\\foo.ts", "src/lib/*")).toBe(true)
  })
})

describe("hasGlob", () => {
  it("'*' veya '?' içeren pattern → true", () => {
    expect(hasGlob("git *")).toBe(true)
    expect(hasGlob("ca?")).toBe(true)
  })
  it("düz pattern → false", () => {
    expect(hasGlob("git push")).toBe(false)
    expect(hasGlob("/abs/path")).toBe(false)
  })
})
