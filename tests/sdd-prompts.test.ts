import { describe, it, expect } from "vitest"
import { sddAssistantPreamble } from "@/lib/sdd-prompts"

describe("sddAssistantPreamble", () => {
  it("requirement.md yolunu içerir", () => {
    const p = sddAssistantPreamble("requirement", "/ws/.codezal/sdd/i/requirement.md")
    expect(p).toContain("/ws/.codezal/sdd/i/requirement.md")
  })

  it("aşamaya özel talimat enjekte eder", () => {
    expect(sddAssistantPreamble("requirement", "p")).toContain("REQUIREMENT")
    expect(sddAssistantPreamble("design", "p")).toContain("DESIGN")
    expect(sddAssistantPreamble("plan", "p")).toContain("PLAN")
    expect(sddAssistantPreamble("plan", "p")).toContain("covers:")
  })

  it("R-blok formatını öğretir", () => {
    expect(sddAssistantPreamble("requirement", "p")).toContain("R-N")
  })

  it("tüm aşamalar için string döner (boş değil)", () => {
    for (const s of ["requirement", "design", "prototype", "plan", "build", "verify"] as const) {
      expect(sddAssistantPreamble(s, "p").length).toBeGreaterThan(20)
    }
  })
})
