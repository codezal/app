import { describe, it, expect } from "vitest"
import { relevanceScore, selectMethods, renderMethodsCatalog, upsertMethod } from "../src/lib/methods/core"
import { DEFAULT_METHODS_CONFIG, type Method } from "../src/lib/methods/types"

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function method(p: Partial<Method> & { name: string; description: string }): Method {
  return {
    id: p.id ?? p.name,
    name: p.name,
    description: p.description,
    steps: p.steps ?? ["adım1", "adım2"],
    triggers: p.triggers,
    scope: p.scope ?? "project",
    createdAt: p.createdAt ?? NOW,
    lastUsedAt: p.lastUsedAt ?? NOW,
    useCount: p.useCount ?? 0,
  }
}

describe("relevanceScore", () => {
  it("sorgu token örtüşme oranı", () => {
    expect(relevanceScore("react bileşeni test et", "react test")).toBe(1)
    expect(relevanceScore("tamamen başka", "react test")).toBe(0)
  })
})

describe("selectMethods", () => {
  it("sorguya göre top-K ilgili method", () => {
    const methods = [
      method({ name: "deploy", description: "vercel deploy süreci", id: "d" }),
      method({ name: "test", description: "vitest ile birim test yaz", id: "t" }),
    ]
    const out = selectMethods(methods, { query: "vitest test yazmak", now: NOW, topK: 1 })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("t")
  })

  it("sorgu varsa alakasızları (skor 0) eler", () => {
    const methods = [method({ name: "x", description: "tamamen alakasız konu" })]
    expect(selectMethods(methods, { query: "react", now: NOW })).toHaveLength(0)
  })

  it("sorgusuz: en faydalı (kullanım/recency) önde", () => {
    const methods = [
      method({ name: "az", description: "a", useCount: 0, id: "az" }),
      method({ name: "cok", description: "b", useCount: 10, id: "cok" }),
    ]
    const out = selectMethods(methods, { now: NOW, topK: 1 })
    expect(out[0].id).toBe("cok")
  })
})

describe("upsertMethod", () => {
  it("aynı ad+scope → üzerine yazar, useCount korur", () => {
    const existing = [method({ name: "deploy", description: "eski", useCount: 5 })]
    const next = method({ name: "deploy", description: "yeni tarif", useCount: 0 })
    const out = upsertMethod(existing, next)
    expect(out).toHaveLength(1)
    expect(out[0].description).toBe("yeni tarif")
    expect(out[0].useCount).toBe(5) // korundu
  })

  it("farklı ad → ekler", () => {
    const out = upsertMethod([method({ name: "a", description: "x" })], method({ name: "b", description: "y" }))
    expect(out).toHaveLength(2)
  })

  it("maxMethods tavanını uygular", () => {
    const methods = Array.from({ length: 5 }, (_, i) =>
      method({ name: "m" + i, description: "d", useCount: i, lastUsedAt: NOW - i * DAY }),
    )
    const next = method({ name: "yeni", description: "d", useCount: 99 })
    const out = upsertMethod(methods, next, { ...DEFAULT_METHODS_CONFIG, maxMethods: 3 })
    expect(out).toHaveLength(3)
    expect(out.some((m) => m.name === "yeni")).toBe(true)
  })
})

describe("renderMethodsCatalog", () => {
  it("adımları numaralı render eder, boşta ''", () => {
    expect(renderMethodsCatalog([])).toBe("")
    const md = renderMethodsCatalog([method({ name: "Deploy", description: "nasıl deploy edilir", steps: ["build", "push"] })])
    expect(md).toContain("## Deploy")
    expect(md).toContain("1. build")
    expect(md).toContain("2. push")
  })
})
