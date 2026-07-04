import { describe, it, expect } from "vitest"
import { briefModeSection } from "@/lib/token-savers/brief-mode/inject"

describe("briefModeSection", () => {
  it("undefined → null", () => {
    expect(briefModeSection(undefined)).toBeNull()
  })

  it("enabled: false → null", () => {
    expect(briefModeSection({ enabled: false, level: "full" })).toBeNull()
  })

  it("enabled: true, lite → LITE direktifi", () => {
    const r = briefModeSection({ enabled: true, level: "lite" })
    expect(r).not.toBeNull()
    expect(r).toContain("LITE")
  })

  it("enabled: true, full → FULL direktifi", () => {
    const r = briefModeSection({ enabled: true, level: "full" })
    expect(r).toContain("FULL")
  })

  it("enabled: true, ultra → ULTRA direktifi", () => {
    const r = briefModeSection({ enabled: true, level: "ultra" })
    expect(r).toContain("ULTRA")
  })
})
