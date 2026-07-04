import { describe, it, expect } from "vitest"
import {
  isModelEnabled,
  listModelStatus,
  buildBulkStatus,
  buildRecommendedStatus,
} from "@/lib/providers/model-status"
import type { ProviderInfo } from "@/lib/providers/types"
import type { Settings } from "@/store/types"

function provider(id: string, recommended: string[] = []): ProviderInfo {
  return {
    id: id as ProviderInfo["id"],
    label: id,
    authMethods: ["apiKey"],
    envVars: [],
    npmPackage: "",
    requiresConfig: false,
    defaultModel: "",
    fallbackModels: [],
    recommendedModels: recommended,
    buildLanguageModel: async () => { throw new Error("mock") },
  }
}

function settings(modelStatus?: Record<string, Record<string, boolean>>): Settings {
  return { modelStatus } as unknown as Settings
}

// ─── isModelEnabled ───────────────────────────────────────────────────────────

describe("isModelEnabled", () => {
  it("status kayıt yoksa ve recommended listesi boşsa → enabled", () => {
    expect(isModelEnabled(provider("openai"), "gpt-4o", settings())).toBe(true)
  })

  it("status kayıt yoksa recommended'daysa → enabled", () => {
    const p = provider("openai", ["gpt-4o", "gpt-4o-mini"])
    expect(isModelEnabled(p, "gpt-4o", settings())).toBe(true)
  })

  it("status kayıt yoksa recommended'da değilse → disabled", () => {
    const p = provider("openai", ["gpt-4o"])
    expect(isModelEnabled(p, "gpt-3.5-turbo", settings())).toBe(false)
  })

  it("status map'te true → enabled", () => {
    const s = settings({ openai: { "gpt-4o": true } })
    expect(isModelEnabled(provider("openai"), "gpt-4o", s)).toBe(true)
  })

  it("status map'te false → disabled", () => {
    const s = settings({ openai: { "gpt-4o": false } })
    expect(isModelEnabled(provider("openai", ["gpt-4o"]), "gpt-4o", s)).toBe(false)
  })

  it("status farklı provider'a ait → etkisiz", () => {
    const s = settings({ anthropic: { "claude-haiku": false } })
    const p = provider("openai", ["gpt-4o"])
    expect(isModelEnabled(p, "gpt-4o", s)).toBe(true)
  })
})

// ─── listModelStatus ──────────────────────────────────────────────────────────

describe("listModelStatus", () => {
  it("tüm catalog modelleri listelenir", () => {
    const p = provider("openai", ["gpt-4o"])
    const r = listModelStatus(p, ["gpt-4o", "gpt-3.5-turbo"], settings())
    expect(r).toHaveLength(2)
    expect(r.map((x) => x.modelId)).toContain("gpt-4o")
    expect(r.map((x) => x.modelId)).toContain("gpt-3.5-turbo")
  })

  it("recommended modeller recommended:true alır", () => {
    const p = provider("openai", ["gpt-4o"])
    const r = listModelStatus(p, ["gpt-4o", "gpt-3.5-turbo"], settings())
    expect(r.find((x) => x.modelId === "gpt-4o")?.recommended).toBe(true)
    expect(r.find((x) => x.modelId === "gpt-3.5-turbo")?.recommended).toBe(false)
  })

  it("enabled durumu settings'ten gelir", () => {
    const p = provider("openai", ["gpt-4o"])
    const s = settings({ openai: { "gpt-4o": false } })
    const r = listModelStatus(p, ["gpt-4o"], s)
    expect(r[0].enabled).toBe(false)
  })

  it("boş catalog → boş dizi", () => {
    expect(listModelStatus(provider("openai"), [], settings())).toEqual([])
  })
})

// ─── buildBulkStatus ─────────────────────────────────────────────────────────

describe("buildBulkStatus", () => {
  it("tüm modeller true yapılır", () => {
    const r = buildBulkStatus(["a", "b", "c"], true)
    expect(r).toEqual({ a: true, b: true, c: true })
  })

  it("tüm modeller false yapılır", () => {
    const r = buildBulkStatus(["a", "b"], false)
    expect(r).toEqual({ a: false, b: false })
  })

  it("boş catalog → boş nesne", () => {
    expect(buildBulkStatus([], true)).toEqual({})
  })
})

// ─── buildRecommendedStatus ───────────────────────────────────────────────────

describe("buildRecommendedStatus", () => {
  it("recommended → true, diğerleri → false", () => {
    const p = provider("openai", ["gpt-4o", "gpt-4o-mini"])
    const r = buildRecommendedStatus(p, ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"])
    expect(r["gpt-4o"]).toBe(true)
    expect(r["gpt-4o-mini"]).toBe(true)
    expect(r["gpt-3.5-turbo"]).toBe(false)
  })

  it("recommended listesi boşsa → hepsi false", () => {
    const r = buildRecommendedStatus(provider("openai"), ["a", "b"])
    expect(r).toEqual({ a: false, b: false })
  })

  it("boş catalog → boş nesne", () => {
    expect(buildRecommendedStatus(provider("openai", ["gpt-4o"]), [])).toEqual({})
  })
})
