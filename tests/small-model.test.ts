import { describe, it, expect } from "vitest"
import { pickSmallModel } from "@/lib/small-model"
import type { ProvidersCatalog } from "@/lib/providers-catalog"

const recent = (monthsAgo: number) =>
  new Date(Date.now() - monthsAgo * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function catalogWith(models: Record<string, { name: string; release_date: string; cost?: { input: number; output: number } }>): ProvidersCatalog {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: Object.fromEntries(
        Object.entries(models).map(([id, m]) => [id, { id, ...m }]),
      ),
    },
  } as unknown as ProvidersCatalog
}

describe("pickSmallModel", () => {
  it("catalog yoksa null", () => {
    expect(pickSmallModel(undefined, "openai")).toBeNull()
  })

  it("bilinmeyen/boş provider → null", () => {
    expect(pickSmallModel(catalogWith({}), "anthropic")).toBeNull()
  })

  it("isim-sinyalli en ucuz modeli seçer (nano < mini < frontier)", () => {
    const cat = catalogWith({
      "gpt-5.5": { name: "GPT-5.5", release_date: recent(2), cost: { input: 5, output: 20 } },
      "gpt-5.4-mini": { name: "GPT-5.4 mini", release_date: recent(3), cost: { input: 0.25, output: 2 } },
      "gpt-5.4-nano": { name: "GPT-5.4 nano", release_date: recent(3), cost: { input: 0.05, output: 0.4 } },
    })
    expect(pickSmallModel(cat, "openai")).toBe("gpt-5.4-nano")
  })

  it("isim-sinyali yoksa skorlanabilir adaylardan en ucuzu", () => {
    const cat = catalogWith({
      "model-big": { name: "Big", release_date: recent(2), cost: { input: 10, output: 30 } },
      "model-cheap": { name: "Cheap", release_date: recent(2), cost: { input: 1, output: 2 } },
    })
    expect(pickSmallModel(cat, "openai")).toBe("model-cheap")
  })

  it("cost verisi yoksa isim-sinyalli en yeni modele düşer (subscription provider)", () => {
    const cat = catalogWith({
      "coder-pro": { name: "Coder Pro", release_date: recent(2) },
      "coder-flash": { name: "Coder Flash", release_date: recent(1) },
    })
    expect(pickSmallModel(cat, "openai")).toBe("coder-flash")
  })

  it("hiç uygun aday yoksa null", () => {
    const cat = catalogWith({
      "coder-pro": { name: "Coder Pro", release_date: recent(2) },
    })
    expect(pickSmallModel(cat, "openai")).toBeNull()
  })
})
