import { describe, it, expect } from "vitest"
import {
  parseRequirementBlocks,
  parseCoveredRequirementIds,
  computeCoverage,
  setRequirementStatuses,
  statusForStage,
} from "@/lib/sdd-trace"

const REQ = [
  "# Başlık",
  "",
  "## R-1 İlk gereksinim {draft}",
  "- [ ] kriter",
  "",
  "### R-2 Alt gereksinim {building}",
  "",
  "## R-3 Token'sız gereksinim",
].join("\n")

describe("parseRequirementBlocks", () => {
  const blocks = parseRequirementBlocks(REQ)
  it("tüm R-blokları bulur (2-4 derinlik)", () => {
    expect(blocks.map((b) => b.id)).toEqual(["R-1", "R-2", "R-3"])
  })
  it("status token'ı okur, yoksa draft", () => {
    expect(blocks[0].status).toBe("draft")
    expect(blocks[1].status).toBe("building")
    expect(blocks[2].status).toBe("draft")
  })
  it("başlıktan id + token çıkarılmış title", () => {
    expect(blocks[0].title).toBe("İlk gereksinim")
    expect(blocks[2].title).toBe("Token'sız gereksinim")
  })
})

describe("parseCoveredRequirementIds", () => {
  it("(covers: ...) etiketlerinden R-id toplar", () => {
    const plan = "- [ ] Adım A (covers: R-1, R-2)\n- [ ] Adım B (covers: R-1)\n- scaffold"
    expect([...parseCoveredRequirementIds(plan)].sort()).toEqual(["R-1", "R-2"])
  })
  it("virgülsüz ayraçları da yakalar (boşluk / 'and')", () => {
    expect([...parseCoveredRequirementIds("(covers: R-3 R-4)")].sort()).toEqual(["R-3", "R-4"])
    expect([...parseCoveredRequirementIds("(covers: R-5 and R-6)")].sort()).toEqual(["R-5", "R-6"])
  })
  it("etiket yoksa boş set", () => {
    expect(parseCoveredRequirementIds("plain plan").size).toBe(0)
  })
})

describe("computeCoverage", () => {
  it("kapsanan/kapsanmayan ayrımı", () => {
    const blocks = parseRequirementBlocks(REQ)
    const cov = computeCoverage(blocks, new Set(["R-1", "R-3"]))
    expect(cov.coveredIds).toEqual(["R-1", "R-3"])
    expect(cov.uncoveredIds).toEqual(["R-2"])
  })
})

describe("setRequirementStatuses (forward-only)", () => {
  it("draft → planned yazar", () => {
    const out = setRequirementStatuses(REQ, { "R-1": "planned" })
    expect(out).toContain("## R-1 İlk gereksinim {planned}")
  })
  it("ileri status'u geri SARMAZ (building → planned no-op)", () => {
    const out = setRequirementStatuses(REQ, { "R-2": "planned" })
    expect(out).toContain("### R-2 Alt gereksinim {building}")
  })
  it("token yoksa başlık sonuna ekler", () => {
    const out = setRequirementStatuses(REQ, { "R-3": "building" })
    expect(out).toContain("## R-3 Token'sız gereksinim {building}")
  })
  it("değişiklik yoksa aynı metni döndürür", () => {
    expect(setRequirementStatuses(REQ, {})).toBe(REQ)
    expect(setRequirementStatuses(REQ, { "R-2": "draft" })).toBe(REQ)
  })
})

describe("statusForStage", () => {
  it("plan→planned, build→building, diğer→null", () => {
    expect(statusForStage("plan")).toBe("planned")
    expect(statusForStage("build")).toBe("building")
    expect(statusForStage("requirement")).toBeNull()
    expect(statusForStage("verify")).toBeNull()
  })
})
