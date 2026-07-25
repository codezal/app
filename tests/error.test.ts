import { describe, it, expect } from "vitest"
import {
  parseStreamError,
  isContentFilterError,
  isContentFilterMessage,
} from "@/lib/providers/error"

// Regression: Alibaba DashScope / Qwen moderation rejections phrase the error
// as "Output data may contain inappropriate content." (code DataInspectionFailed).
// The stream loop must classify these as content-filter errors so the user sees
// the localized banner and their message is restored to the composer — instead
// of the raw English string leaking through and the turn dying half-finished.
const QWEN_OUTPUT_FILTER = "Output data may contain inappropriate content."
const QWEN_INPUT_FILTER = "Input data may contain inappropriate content."

describe("isContentFilterMessage", () => {
  it("Qwen/DashScope output moderation message", () => {
    expect(isContentFilterMessage(QWEN_OUTPUT_FILTER)).toBe(true)
  })
  it("Qwen/DashScope input moderation message", () => {
    expect(isContentFilterMessage(QWEN_INPUT_FILTER)).toBe(true)
  })
  it("embedded data_inspection code phrasing", () => {
    expect(isContentFilterMessage("Error: data inspection failed")).toBe(true)
  })
  it("existing phrasings still match", () => {
    expect(isContentFilterMessage("Violated our content policy")).toBe(true)
    expect(isContentFilterMessage("Blocked by moderation system")).toBe(true)
  })
  it("unrelated errors do not match", () => {
    expect(isContentFilterMessage("Rate limit exceeded")).toBe(false)
    expect(isContentFilterMessage("connection reset by peer")).toBe(false)
    expect(isContentFilterMessage("Unauthorized: bad api key")).toBe(false)
  })
})

describe("isContentFilterError", () => {
  it("400 api_error with Qwen message", () => {
    expect(
      isContentFilterError({
        type: "api_error",
        message: QWEN_OUTPUT_FILTER,
        statusCode: 400,
        isRetryable: false,
      }),
    ).toBe(true)
  })
  it("mid-stream chunk (no status code) with Qwen message", () => {
    expect(
      isContentFilterError({
        type: "api_error",
        message: QWEN_OUTPUT_FILTER,
        isRetryable: false,
      }),
    ).toBe(true)
  })
  it("5xx is a server failure, not a content filter", () => {
    expect(
      isContentFilterError({
        type: "api_error",
        message: QWEN_OUTPUT_FILTER,
        statusCode: 500,
        isRetryable: true,
      }),
    ).toBe(false)
  })
  it("context_overflow type is never a content filter", () => {
    expect(
      isContentFilterError({ type: "context_overflow", message: QWEN_OUTPUT_FILTER }),
    ).toBe(false)
  })
})

describe("parseStreamError classifies mid-stream moderation chunks", () => {
  it("Error instance with Qwen message → non-retryable api_error", () => {
    const parsed = parseStreamError(new Error(QWEN_OUTPUT_FILTER))
    expect(parsed?.type).toBe("api_error")
    if (parsed?.type === "api_error") {
      expect(parsed.isRetryable).toBe(false)
      expect(isContentFilterError(parsed)).toBe(true)
    }
  })
  it("bare string with Qwen message → non-retryable api_error", () => {
    const parsed = parseStreamError(QWEN_OUTPUT_FILTER)
    expect(parsed?.type).toBe("api_error")
    if (parsed?.type === "api_error") expect(parsed.isRetryable).toBe(false)
  })
  it("transient network errors stay retryable (regression guard)", () => {
    const parsed = parseStreamError(new Error("connection reset by peer"))
    expect(parsed?.type).toBe("api_error")
    if (parsed?.type === "api_error") expect(parsed.isRetryable).toBe(true)
  })
  it("overflow still wins over content filter", () => {
    const parsed = parseStreamError(new Error("prompt is too long"))
    expect(parsed?.type).toBe("context_overflow")
  })
})
