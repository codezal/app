import { describe, it, expect } from "vitest"
import {
  defaultRequirementMarkdown,
  sddDraftDir,
  sddImgDir,
  sddMetaPath,
  sddPlanPath,
  sddProtoDir,
  sddRequirementPath,
} from "@/lib/sdd-store"

describe("sdd-store paths", () => {
  it("draft dizini .codezal/sdd/<id> altında", () => {
    expect(sddDraftDir("/ws", "sdd_1")).toBe("/ws/.codezal/sdd/sdd_1")
  })

  it("trailing ayraç temizlenir (mac + win)", () => {
    expect(sddDraftDir("/ws/", "sdd_1")).toBe("/ws/.codezal/sdd/sdd_1")
    expect(sddDraftDir("C:\\ws\\", "sdd_1")).toBe("C:\\ws/.codezal/sdd/sdd_1")
  })

  it("artefakt path'leri doğru", () => {
    expect(sddRequirementPath("/ws", "i")).toBe("/ws/.codezal/sdd/i/requirement.md")
    expect(sddMetaPath("/ws", "i")).toBe("/ws/.codezal/sdd/i/meta.json")
    expect(sddPlanPath("/ws", "i")).toBe("/ws/.codezal/sdd/i/plan.md")
    expect(sddImgDir("/ws", "i")).toBe("/ws/.codezal/sdd/i/img")
    expect(sddProtoDir("/ws", "i")).toBe("/ws/.codezal/sdd/i/proto")
  })
})

describe("defaultRequirementMarkdown", () => {
  const md = defaultRequirementMarkdown("Seyahat Sitesi")

  it("başlığı H1 olarak içerir", () => {
    expect(md).toContain("# Seyahat Sitesi")
  })

  it("R-blok formatını + {draft} status token'ını öğretir", () => {
    expect(md).toMatch(/## R-1 .+ \{draft\}/)
  })

  it("en az bir kabul kriteri checkbox'ı içerir", () => {
    expect(md).toContain("- [ ] ")
  })
})
