import { describe, it, expect } from "vitest"
import {
  deriveCatalogProviders,
  getCatalogProviderDefaults,
} from "@/lib/providers/catalog-derived"
import type { ProvidersCatalog } from "@/lib/providers-catalog"

const CATALOG: ProvidersCatalog = {
  // Builtin — should be skipped
  openai: { name: "OpenAI", api: "https://api.openai.com/v1", env: ["OPENAI_API_KEY"], models: [] },
  // Catalog-only with routable API
  fireworks: {
    name: "Fireworks AI",
    api: "https://api.fireworks.ai/inference/v1",
    env: ["FIREWORKS_API_KEY"],
    models: [],
  },
  together: {
    name: "Together AI",
    api: "https://api.together.xyz/v1",
    env: ["TOGETHER_API_KEY"],
    models: [],
  },
  // Promoted into the popular tier (coding-plan endpoint)
  "kimi-for-coding": {
    name: "Kimi For Coding",
    api: "https://api.moonshot.ai/v1",
    env: [],
    models: [],
  },
  // No API URL — not routable via OpenAI-compatible
  "no-api": { name: "No API Provider", api: undefined as unknown as string, env: [], models: [] },
} as unknown as ProvidersCatalog

describe("deriveCatalogProviders", () => {
  it("undefined catalog → boş dizi", () => {
    expect(deriveCatalogProviders(undefined)).toEqual([])
  })

  it("builtin provider atlanır", () => {
    const r = deriveCatalogProviders(CATALOG)
    expect(r.find((p) => p.id === "openai")).toBeUndefined()
  })

  it("routable catalog provider dahil edilir", () => {
    const r = deriveCatalogProviders(CATALOG)
    const ids = r.map((p) => p.id)
    expect(ids).toContain("fireworks")
    expect(ids).toContain("together")
  })

  it("api alanı olmayan provider atlanır", () => {
    const r = deriveCatalogProviders(CATALOG)
    expect(r.find((p) => p.id === "no-api")).toBeUndefined()
  })

  it("adapter label kataloğun name'ini alır", () => {
    const r = deriveCatalogProviders(CATALOG)
    const fw = r.find((p) => p.id === "fireworks")!
    expect(fw.label).toBe("Fireworks AI")
  })

  it("envVars varsa authMethods apiKey+env içerir", () => {
    const r = deriveCatalogProviders(CATALOG)
    const fw = r.find((p) => p.id === "fireworks")!
    expect(fw.authMethods).toContain("apiKey")
    expect(fw.authMethods).toContain("env")
  })

  it("envVars yoksa authMethods sadece apiKey", () => {
    const cat = {
      myProvider: { name: "My Provider", api: "https://my.api/v1", env: [], models: [] },
    } as unknown as ProvidersCatalog
    const r = deriveCatalogProviders(cat)
    expect(r[0].authMethods).toEqual(["apiKey"])
  })

  it("promoted coding-plan provider popular=true", () => {
    const r = deriveCatalogProviders(CATALOG)
    expect(r.find((p) => p.id === "kimi-for-coding")?.popular).toBe(true)
  })

  it("sıradan catalog provider popular değil", () => {
    const r = deriveCatalogProviders(CATALOG)
    expect(r.find((p) => p.id === "fireworks")?.popular).toBeFalsy()
  })
})

describe("getCatalogProviderDefaults", () => {
  it("undefined catalog → null", () => {
    expect(getCatalogProviderDefaults(undefined, "fireworks")).toBeNull()
  })

  it("builtin id → null", () => {
    expect(getCatalogProviderDefaults(CATALOG, "openai")).toBeNull()
  })

  it("var olan catalog provider → baseURL + envVars döner", () => {
    const r = getCatalogProviderDefaults(CATALOG, "fireworks")
    expect(r).not.toBeNull()
    expect(r!.baseURL).toBe("https://api.fireworks.ai/inference/v1")
    expect(r!.envVars).toContain("FIREWORKS_API_KEY")
  })

  it("api yoksa → null", () => {
    expect(getCatalogProviderDefaults(CATALOG, "no-api")).toBeNull()
  })

  it("olmayan id → null", () => {
    expect(getCatalogProviderDefaults(CATALOG, "nonexistent")).toBeNull()
  })
})
