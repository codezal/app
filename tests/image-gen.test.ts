import { describe, it, expect } from "vitest"
import {
  imageEndpoint,
  buildImageBody,
  parseImageResult,
  imagePreset,
  IMAGE_PRESETS,
  isStockImageModel,
} from "@/lib/image-gen"

describe("imageEndpoint", () => {
  it("appends /v1/images/generations when base has no version", () => {
    expect(imageEndpoint("openai-image", "https://api.openai.com")).toBe(
      "https://api.openai.com/v1/images/generations",
    )
  })
  it("does not double the version when base already ends in /v1", () => {
    expect(imageEndpoint("openai-image", "https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/images/generations",
    )
  })
  it("strips trailing slashes", () => {
    expect(imageEndpoint("openai-image", "https://x.test/v1/")).toBe(
      "https://x.test/v1/images/generations",
    )
  })
  it("builds the minimax endpoint", () => {
    expect(imageEndpoint("minimax-image", "https://api.minimax.chat")).toBe(
      "https://api.minimax.chat/v1/image_generation",
    )
    expect(imageEndpoint("minimax-image", "https://api.minimax.chat/v1")).toBe(
      "https://api.minimax.chat/v1/image_generation",
    )
  })
})

describe("buildImageBody", () => {
  it("openai-image: includes a concrete size, omits n/model defaults aside", () => {
    const body = buildImageBody("openai-image", "gpt-image-1", "a cat", "1024x1024")
    expect(body).toMatchObject({ model: "gpt-image-1", prompt: "a cat", n: 1, size: "1024x1024" })
  })
  it("openai-image: omits size when 'auto' or empty", () => {
    expect(buildImageBody("openai-image", "m", "p", "auto").size).toBeUndefined()
    expect(buildImageBody("openai-image", "m", "p", "").size).toBeUndefined()
    expect(buildImageBody("openai-image", "m", "p").size).toBeUndefined()
  })
  it("minimax-image: maps size to aspect_ratio and asks for a url", () => {
    const body = buildImageBody("minimax-image", "image-01", "p", "16:9")
    expect(body).toMatchObject({ model: "image-01", response_format: "url", aspect_ratio: "16:9" })
  })
})

describe("parseImageResult", () => {
  it("openai-image: extracts b64_json", () => {
    expect(parseImageResult("openai-image", { data: [{ b64_json: "AAAA" }] })).toEqual({ b64: "AAAA" })
  })
  it("openai-image: extracts url when no b64", () => {
    expect(parseImageResult("openai-image", { data: [{ url: "https://i/x.png" }] })).toEqual({
      remoteUrl: "https://i/x.png",
    })
  })
  it("openai-image: surfaces an error object", () => {
    expect(parseImageResult("openai-image", { error: { message: "bad key" } })).toEqual({ error: "bad key" })
  })
  it("openai-image: empty data → error", () => {
    expect(parseImageResult("openai-image", { data: [] }).error).toBeTruthy()
  })
  it("minimax-image: extracts image_urls[0]", () => {
    expect(
      parseImageResult("minimax-image", { data: { image_urls: ["https://m/x.png"] } }),
    ).toEqual({ remoteUrl: "https://m/x.png" })
  })
  it("minimax-image: surfaces base_resp error", () => {
    expect(
      parseImageResult("minimax-image", { base_resp: { status_code: 1004, status_msg: "auth" } }).error,
    ).toBe("auth")
  })
  it("non-object → error", () => {
    expect(parseImageResult("openai-image", null).error).toBeTruthy()
  })
})

describe("imagePreset", () => {
  it("resolves the named presets", () => {
    expect(imagePreset("openai")?.protocol).toBe("openai-image")
    expect(imagePreset("openai")?.baseUrl).toBe("https://api.openai.com/v1")
    expect(imagePreset("gemini")?.protocol).toBe("openai-image")
    expect(imagePreset("minimax")?.protocol).toBe("minimax-image")
  })
  it("openai/gemini reuse a built-in provider; minimax does not", () => {
    expect(imagePreset("openai")?.reuseProvider).toBe("openai")
    expect(imagePreset("gemini")?.reuseProvider).toBe("google")
    expect(imagePreset("minimax")?.reuseProvider).toBeUndefined()
  })
  it("returns undefined for custom / unknown ids", () => {
    expect(imagePreset("custom")).toBeUndefined()
    expect(imagePreset("")).toBeUndefined()
    expect(imagePreset(undefined)).toBeUndefined()
  })
  it("every preset has a default model", () => {
    for (const p of IMAGE_PRESETS) expect(p.defaultModel.length).toBeGreaterThan(0)
  })
})

describe("isStockImageModel", () => {
  it("treats blank and preset defaults as stock (overwritable)", () => {
    expect(isStockImageModel("")).toBe(true)
    expect(isStockImageModel(undefined)).toBe(true)
    expect(isStockImageModel("gpt-image-1")).toBe(true)
    expect(isStockImageModel("image-01")).toBe(true)
  })
  it("treats a user-typed model as non-stock (preserve on switch)", () => {
    expect(isStockImageModel("dall-e-3")).toBe(false)
    expect(isStockImageModel("my-custom-model")).toBe(false)
  })
})
