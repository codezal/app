import { describe, it, expect } from "vitest"
import { localeFromTag, languageName } from "@/lib/i18n/types"

describe("localeFromTag — OS/BCP-47 tag → supported Locale", () => {
  it("matches an exact supported code (case-insensitive)", () => {
    expect(localeFromTag("tr")).toBe("tr")
    expect(localeFromTag("EN")).toBe("en")
    expect(localeFromTag("pt-BR")).toBe("pt-BR")
    expect(localeFromTag("zh-CN")).toBe("zh-CN")
  })

  it("strips region for language-only fallback", () => {
    expect(localeFromTag("tr-TR")).toBe("tr")
    expect(localeFromTag("de-AT")).toBe("de")
    expect(localeFromTag("en-US")).toBe("en")
  })

  it("normalizes underscores and case", () => {
    expect(localeFromTag("pt_BR")).toBe("pt-BR")
    expect(localeFromTag("PT-br")).toBe("pt-BR")
  })

  it("maps Portuguese variants to pt-BR", () => {
    expect(localeFromTag("pt")).toBe("pt-BR")
    expect(localeFromTag("pt-PT")).toBe("pt-BR")
  })

  it("maps Chinese script/region to the right variant", () => {
    expect(localeFromTag("zh")).toBe("zh-CN")
    expect(localeFromTag("zh-Hans-CN")).toBe("zh-CN")
    expect(localeFromTag("zh-Hant-TW")).toBe("zh-TW")
    expect(localeFromTag("zh-HK")).toBe("zh-TW")
    expect(localeFromTag("zh-MO")).toBe("zh-TW")
  })

  it("returns null for empty or unsupported tags", () => {
    expect(localeFromTag("")).toBeNull()
    expect(localeFromTag("   ")).toBeNull()
    expect(localeFromTag("C")).toBeNull()
    expect(localeFromTag("POSIX")).toBeNull()
    expect(localeFromTag("xx-YY")).toBeNull()
  })
})

describe("languageName — Locale → English name", () => {
  it("returns the English language name for a locale", () => {
    expect(languageName("tr")).toBe("Turkish")
    expect(languageName("en")).toBe("English")
    expect(languageName("zh-CN")).toBe("Simplified Chinese")
    expect(languageName("pt-BR")).toBe("Brazilian Portuguese")
  })
})
