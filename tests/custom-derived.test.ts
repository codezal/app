import { describe, it, expect } from "vitest"
import { deriveCustomProviders } from "@/lib/providers/custom-derived"
import { parseSettings } from "@/lib/config/schema"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"
import type { CustomProvider } from "@/lib/providers"

const SAMPLE: CustomProvider = {
  id: "my-llm",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  models: [
    { id: "fast", name: "Fast Model", contextWindow: 1_000_000 },
    { id: "slow" },
  ],
  headers: { "X-Org": "acme" },
}

describe("deriveCustomProviders", () => {
  it("undefined/boş liste → boş dizi", () => {
    expect(deriveCustomProviders(undefined)).toEqual([])
    expect(deriveCustomProviders([])).toEqual([])
  })

  it("geçerli custom provider → adapter sentezlenir", () => {
    const [a] = deriveCustomProviders([SAMPLE])
    expect(a.id).toBe("my-llm")
    expect(a.label).toBe("My LLM")
    expect(a.custom).toBe(true)
    expect(a.authMethods).toEqual(["apiKey"])
  })

  it("fallbackModels model id'lerinden gelir, defaultModel ilk model", () => {
    const [a] = deriveCustomProviders([SAMPLE])
    expect(a.fallbackModels).toEqual(["fast", "slow"])
    expect(a.defaultModel).toBe("fast")
  })

  it("name boşsa label id'e düşer", () => {
    const [a] = deriveCustomProviders([{ ...SAMPLE, name: "" }])
    expect(a.label).toBe("my-llm")
  })

  it("id veya baseURL boş olan giriş atlanır", () => {
    const r = deriveCustomProviders([
      { ...SAMPLE, id: "" },
      { ...SAMPLE, id: "ok", baseURL: "" },
    ])
    expect(r).toEqual([])
  })
})

describe("parseSettings — customProviders", () => {
  it("geçerli liste round-trip korunur", () => {
    const out = parseSettings({ customProviders: [SAMPLE] }, DEFAULT_SETTINGS)
    expect(out.customProviders).toHaveLength(1)
    expect(out.customProviders?.[0].id).toBe("my-llm")
    expect(out.customProviders?.[0].models).toHaveLength(2)
    expect(out.customProviders?.[0].models[0]?.contextWindow).toBe(1_000_000)
  })

  it("alan yoksa default boş dizi", () => {
    const out = parseSettings({}, DEFAULT_SETTINGS)
    expect(out.customProviders).toEqual([])
  })

  it("dizi olmayan bozuk değer → default'a düşer", () => {
    const out = parseSettings({ customProviders: "nope" }, DEFAULT_SETTINGS)
    expect(out.customProviders).toEqual([])
  })

  it("tek bozuk entry düşer, geçerliler korunur (liste nuke edilmez)", () => {
    const out = parseSettings(
      { customProviders: [SAMPLE, { foo: 1 }, { id: "x" /* baseURL yok */ }] },
      DEFAULT_SETTINGS,
    )
    expect(out.customProviders).toHaveLength(1)
    expect(out.customProviders?.[0].id).toBe("my-llm")
  })
})
