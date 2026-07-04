import { describe, it, expect } from "vitest"
import { APICallError } from "ai"
import {
  isOverflow,
  parseStreamError,
  parseAPICallError,
  isContextOverflow,
  isRetryableError,
  isTransientNetworkError,
  retryDelayMs,
} from "@/lib/providers/error"

describe("isOverflow", () => {
  it("sağlayıcıya özgü overflow mesajları yakalanır", () => {
    expect(isOverflow("prompt is too long")).toBe(true) // Anthropic
    expect(isOverflow("This model's maximum context length is 128000 tokens")).toBe(true) // OpenAI/OR
    expect(isOverflow("Input token count exceeds the maximum")).toBe(true) // Gemini
    expect(isOverflow("413 (no body)")).toBe(true) // Cerebras/Mistral bare
  })
  it("alakasız hata → false", () => {
    expect(isOverflow("invalid api key")).toBe(false)
    expect(isOverflow("rate limit exceeded")).toBe(false)
  })
})

describe("parseStreamError", () => {
  it("Error içindeki overflow mesajı context_overflow döner", () => {
    const r = parseStreamError(new Error("prompt is too long: 250000 tokens"))
    expect(r?.type).toBe("context_overflow")
  })
  it("overflow olmayan Error → undefined", () => {
    expect(parseStreamError(new Error("network timeout"))).toBeUndefined()
  })
  it("string input desteklenir", () => {
    expect(parseStreamError("context_length_exceeded")?.type).toBe("context_overflow")
  })
  it("plugin-http decode/network hatası → retryable api_error", () => {
    const r = parseStreamError(new Error("error decoding response body"))
    expect(r?.type).toBe("api_error")
    expect(isRetryableError(r)).toBe(true)
  })
})

describe("isTransientNetworkError", () => {
  it("reqwest/ağ transport hataları yakalanır", () => {
    expect(isTransientNetworkError("error decoding response body")).toBe(true)
    expect(isTransientNetworkError("error sending request for url (https://api.deepseek.com)")).toBe(true)
    expect(isTransientNetworkError("connection closed before message completed")).toBe(true)
    expect(isTransientNetworkError("tcp connect error: Connection refused")).toBe(true)
  })
  it("HTTP-status / kalıcı hatalar transient sayılmaz", () => {
    expect(isTransientNetworkError("prompt is too long")).toBe(false)
    expect(isTransientNetworkError("invalid x-api-key")).toBe(false)
    expect(isTransientNetworkError("Unexpected token < in JSON")).toBe(false)
  })
})

describe("parseAPICallError", () => {
  it("413 → context_overflow", () => {
    const e = new APICallError({
      message: "Request entity too large",
      url: "https://x/y",
      requestBodyValues: {},
      statusCode: 413,
      responseBody: "",
      isRetryable: false,
    })
    expect(parseAPICallError(e).type).toBe("context_overflow")
  })
  it("500 → api_error (retryable)", () => {
    const e = new APICallError({
      message: "Internal server error",
      url: "https://x/y",
      requestBodyValues: {},
      statusCode: 500,
      responseBody: "",
      isRetryable: true,
    })
    const r = parseAPICallError(e)
    expect(r.type).toBe("api_error")
    if (r.type === "api_error") {
      expect(r.statusCode).toBe(500)
      expect(r.isRetryable).toBe(true)
    }
  })
})

describe("isContextOverflow", () => {
  it("APICallError 413 → true", () => {
    const e = new APICallError({
      message: "exceeds the context window",
      url: "https://x/y",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: "",
      isRetryable: false,
    })
    expect(isContextOverflow(e)).toBe(true)
  })
})

describe("isRetryableError", () => {
  it("5xx → true (SDK flag false olsa bile)", () => {
    expect(isRetryableError({ type: "api_error", message: "", statusCode: 503, isRetryable: false })).toBe(true)
  })
  it("429 → true", () => {
    expect(isRetryableError({ type: "api_error", message: "", statusCode: 429, isRetryable: false })).toBe(true)
  })
  it("SDK isRetryable=true → true", () => {
    expect(isRetryableError({ type: "api_error", message: "", statusCode: 400, isRetryable: true })).toBe(true)
  })
  it("400 + non-retryable → false", () => {
    expect(isRetryableError({ type: "api_error", message: "", statusCode: 400, isRetryable: false })).toBe(false)
  })
  it("context_overflow asla retry edilmez", () => {
    expect(isRetryableError({ type: "context_overflow", message: "" })).toBe(false)
  })
  it("undefined → false", () => {
    expect(isRetryableError(undefined)).toBe(false)
  })
})

describe("retryDelayMs", () => {
  it("Retry-After (ms) varsa ona uyar", () => {
    expect(retryDelayMs(1, 5000)).toBe(5000)
  })
  it("header tavanı 2 dakika", () => {
    expect(retryDelayMs(1, 999_999)).toBe(120_000)
  })
  it("header yoksa exponential backoff (2s/4s/8s)", () => {
    expect(retryDelayMs(1)).toBe(2000)
    expect(retryDelayMs(2)).toBe(4000)
    expect(retryDelayMs(3)).toBe(8000)
  })
  it("backoff tavanı 30s", () => {
    expect(retryDelayMs(10)).toBe(30_000)
  })
})

describe("parseAPICallError retry-after", () => {
  it("Retry-After saniye → retryAfterMs (ms)", () => {
    const e = new APICallError({
      message: "rate limited",
      url: "https://x/y",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: "",
      isRetryable: true,
      responseHeaders: { "retry-after": "3" },
    })
    const r = parseAPICallError(e)
    expect(r.type).toBe("api_error")
    if (r.type === "api_error") expect(r.retryAfterMs).toBe(3000)
  })
  it("retry-after-ms önceliklidir", () => {
    const e = new APICallError({
      message: "rate limited",
      url: "https://x/y",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: "",
      isRetryable: true,
      responseHeaders: { "retry-after-ms": "1500", "retry-after": "9" },
    })
    const r = parseAPICallError(e)
    if (r.type === "api_error") expect(r.retryAfterMs).toBe(1500)
  })
})
