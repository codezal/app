import { describe, it, expect } from "vitest"
import {
  modelAcceptsImages,
  modelAcceptsPdf,
  looksLikeVisionModel,
  isKnownVisionModel,
  type ProvidersCatalog,
} from "@/lib/providers-catalog"

function cat(input: string[] | undefined): ProvidersCatalog {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: { m: { id: "m", ...(input ? { modalities: { input } } : {}) } },
    },
  } as unknown as ProvidersCatalog
}

function alibabaCat(models: Record<string, string[] | undefined>): ProvidersCatalog {
  const entries: Record<string, { id: string; modalities?: { input: string[] } }> = {}
  for (const [id, input] of Object.entries(models)) {
    entries[id] = { id, ...(input ? { modalities: { input } } : {}) }
  }
  return {
    alibaba: { id: "alibaba", name: "Alibaba", models: entries },
  } as unknown as ProvidersCatalog
}

describe("looksLikeVisionModel", () => {
  it("vl / omni / qvq aileleri true", () => {
    expect(looksLikeVisionModel("qwen3-vl-plus")).toBe(true)
    expect(looksLikeVisionModel("qwen3-omni-flash")).toBe(true)
    expect(looksLikeVisionModel("qvq-max")).toBe(true)
    expect(looksLikeVisionModel("gpt-4o")).toBe(true)
  })
  it("non-VL Qwen max/coder isimden false (allowlist isKnownVisionModel'de)", () => {
    expect(looksLikeVisionModel("qwen3-max")).toBe(false)
    expect(looksLikeVisionModel("qwen3.8-max-preview")).toBe(false)
    expect(looksLikeVisionModel("qwen3-coder-plus")).toBe(false)
  })
})

describe("isKnownVisionModel", () => {
  it("QwenCloud vision understanding modelleri true", () => {
    expect(isKnownVisionModel("qwen3.8-max-preview")).toBe(true)
    expect(isKnownVisionModel("qwen3.7-plus")).toBe(true)
    expect(isKnownVisionModel("qwen3.6-plus")).toBe(true)
    expect(isKnownVisionModel("qwen3.6-flash")).toBe(true)
    expect(isKnownVisionModel("qwen3.5-plus")).toBe(true)
    expect(isKnownVisionModel("qwen3-vl-plus")).toBe(true)
  })
  it("text-only Qwen max/coder false", () => {
    expect(isKnownVisionModel("qwen3-max")).toBe(false)
    expect(isKnownVisionModel("qwen3.7-max")).toBe(false)
    expect(isKnownVisionModel("qwen3.6-max-preview")).toBe(false)
    expect(isKnownVisionModel("qwen3-coder-plus")).toBe(false)
  })
})

describe("modelAcceptsImages", () => {
  it("image input modaliteli model → true", () => {
    expect(modelAcceptsImages(cat(["text", "image"]), "openai", "m")).toBe(true)
  })
  it("sadece text input → false", () => {
    expect(modelAcceptsImages(cat(["text"]), "openai", "m")).toBe(false)
  })
  it("modalite verisi yok + generic model → true (engelleme yok)", () => {
    expect(modelAcceptsImages(cat(undefined), "openai", "m")).toBe(true)
  })
  it("katalog yok + generic → true", () => {
    expect(modelAcceptsImages(undefined, "openai", "m")).toBe(true)
  })
  it("bilinmeyen model (katalogda yok) + generic → true", () => {
    expect(modelAcceptsImages(cat(["text"]), "openai", "other")).toBe(true)
  })
  it("Alibaba Qwen text-only katalogda image yok → false", () => {
    const c = alibabaCat({ "qwen3-max": ["text"] })
    expect(modelAcceptsImages(c, "alibaba", "qwen3-max")).toBe(false)
  })
  it("qwen3.8-max-preview vision — katalog stale text-only olsa bile true", () => {
    const c = alibabaCat({ "qwen3.8-max-preview": ["text"] })
    expect(modelAcceptsImages(c, "alibaba", "qwen3.8-max-preview")).toBe(true)
    expect(modelAcceptsImages(undefined, "alibaba", "qwen3.8-max-preview")).toBe(true)
  })
  it("Alibaba VL model katalogda yok ama isim vision → true", () => {
    expect(modelAcceptsImages(undefined, "alibaba", "qwen3-vl-plus")).toBe(true)
  })
  it("Alibaba VL model katalogda image → true", () => {
    const c = alibabaCat({ "qwen3-vl-plus": ["text", "image"] })
    expect(modelAcceptsImages(c, "alibaba", "qwen3-vl-plus")).toBe(true)
  })
  it("qwen3-coder-plus katalog yok → false", () => {
    expect(modelAcceptsImages(undefined, "alibaba", "qwen3-coder-plus")).toBe(false)
  })
})

describe("modelAcceptsPdf", () => {
  it("pdf input modaliteli model → true", () => {
    expect(modelAcceptsPdf(cat(["text", "image", "pdf"]), "openai", "m")).toBe(true)
  })
  it("pdf'siz input → false", () => {
    expect(modelAcceptsPdf(cat(["text", "image"]), "openai", "m")).toBe(false)
  })
  it("modalite verisi yok → false (KESİN bilgi yok, native deneme)", () => {
    expect(modelAcceptsPdf(cat(undefined), "openai", "m")).toBe(false)
  })
  it("katalog yok → false", () => {
    expect(modelAcceptsPdf(undefined, "openai", "m")).toBe(false)
  })
  it("bilinmeyen model → false (veri yok)", () => {
    expect(modelAcceptsPdf(cat(["text", "pdf"]), "openai", "other")).toBe(false)
  })
})
