import { describe, it, expect } from "vitest"
import { modelAcceptsImages, modelAcceptsPdf, type ProvidersCatalog } from "@/lib/providers-catalog"

function cat(input: string[] | undefined): ProvidersCatalog {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: { m: { id: "m", ...(input ? { modalities: { input } } : {}) } },
    },
  } as unknown as ProvidersCatalog
}

describe("modelAcceptsImages", () => {
  it("image input modaliteli model → true", () => {
    expect(modelAcceptsImages(cat(["text", "image"]), "openai", "m")).toBe(true)
  })
  it("sadece text input → false", () => {
    expect(modelAcceptsImages(cat(["text"]), "openai", "m")).toBe(false)
  })
  it("modalite verisi yok → true (engelleme yok)", () => {
    expect(modelAcceptsImages(cat(undefined), "openai", "m")).toBe(true)
  })
  it("katalog yok → true", () => {
    expect(modelAcceptsImages(undefined, "openai", "m")).toBe(true)
  })
  it("bilinmeyen model → true (veri yok)", () => {
    expect(modelAcceptsImages(cat(["text"]), "openai", "other")).toBe(true)
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
