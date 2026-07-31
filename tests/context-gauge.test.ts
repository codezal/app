import { describe, it, expect } from "vitest"
import {
  extractProviderStepUsage,
  isTrustworthyProviderTotal,
  lastStepTotalTokens,
  providerContextTotal,
  resolveContextTokens,
  streamStartContextTokens,
  PROMPT_TOKEN_TRUST_HIGH,
  PROMPT_TOKEN_TRUST_LOW,
} from "@/lib/context-gauge"

describe("providerContextTotal", () => {
  it("does NOT double-count cache when inputTokens already includes it", () => {
    // Standard AI SDK / Anthropic / OpenAI: inputTokens is cache-inclusive.
    expect(
      providerContextTotal({
        inputTokens: 210_000,
        outputTokens: 500,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 1_000,
      }),
    ).toBe(210_500)
  })

  it("adds cache when inputTokens is miss-only (input < cacheRead)", () => {
    // Qwen/Alibaba-style: input is only the miss slice.
    expect(
      providerContextTotal({
        inputTokens: 10_000,
        outputTokens: 500,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 1_000,
      }),
    ).toBe(211_500)
  })

  it("prefers noCache + cache breakdown when present", () => {
    expect(
      providerContextTotal({
        inputTokens: 210_000, // would also be inclusive, but noCache wins
        outputTokens: 500,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 1_000,
        noCacheTokens: 9_000,
      }),
    ).toBe(210_500)
  })

  it("falls back to totalTokens when input missing", () => {
    expect(
      providerContextTotal({
        totalTokens: 42_000,
        outputTokens: 2_000,
      }),
    ).toBe(42_000)
  })

  it("treats missing fields as 0", () => {
    expect(providerContextTotal({ inputTokens: 100 })).toBe(100)
  })
})

describe("lastStepTotalTokens", () => {
  it("returns 0 when last* cleared after compact", () => {
    expect(
      lastStepTotalTokens({
        lastInputTokens: undefined,
        lastOutputTokens: undefined,
        lastCacheReadTokens: undefined,
        lastCacheWriteTokens: undefined,
      }),
    ).toBe(0)
  })

  it("reconstructs last-step total without double-counting inclusive input", () => {
    // lastInput already includes cacheRead (standard providers).
    expect(
      lastStepTotalTokens({
        lastInputTokens: 200_000,
        lastOutputTokens: 1_000,
        lastCacheReadTokens: 180_000,
        lastCacheWriteTokens: 0,
      }),
    ).toBe(201_000)
  })

  it("adds cache when lastInput is miss-only", () => {
    expect(
      lastStepTotalTokens({
        lastInputTokens: 20_000,
        lastOutputTokens: 1_000,
        lastCacheReadTokens: 180_000,
        lastCacheWriteTokens: 0,
      }),
    ).toBe(201_000)
  })
})

describe("isTrustworthyProviderTotal", () => {
  it("rejects inflated totals (MiniMax-style cumulative cache)", () => {
    const estimate = 30_000
    const inflated = estimate * PROMPT_TOKEN_TRUST_HIGH + 1
    expect(isTrustworthyProviderTotal(inflated, estimate, 0)).toBe(false)
  })

  it("rejects deflated cache-miss shadow (Qwen omit cacheRead)", () => {
    const estimate = 239_500
    const shadow = Math.floor(estimate * PROMPT_TOKEN_TRUST_LOW) - 1
    expect(isTrustworthyProviderTotal(shadow, estimate, 0)).toBe(false)
  })

  it("accepts deflated total when cacheRead is present", () => {
    // Provider may report input as miss-only but still expose cacheRead.
    expect(isTrustworthyProviderTotal(20_000, 239_500, 200_000)).toBe(true)
  })

  it("accepts totals near the estimate", () => {
    expect(isTrustworthyProviderTotal(240_000, 239_500, 200_000)).toBe(true)
    expect(isTrustworthyProviderTotal(100_000, 90_000, 0)).toBe(true)
  })
})

describe("resolveContextTokens", () => {
  it("uses estimate when no provider usage", () => {
    expect(resolveContextTokens({ estimate: 12_345 })).toBe(12_345)
  })

  it("uses provider total when trustworthy (miss-only + cache)", () => {
    expect(
      resolveContextTokens({
        estimate: 50_000,
        provider: {
          inputTokens: 10_000,
          outputTokens: 2_000,
          cacheReadTokens: 40_000,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(52_000)
  })

  it("uses provider total when input already includes cache (no double-count)", () => {
    expect(
      resolveContextTokens({
        estimate: 50_000,
        provider: {
          inputTokens: 50_000,
          outputTokens: 2_000,
          cacheReadTokens: 40_000,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(52_000)
  })

  it("falls back to estimate on cache-miss shadow (239.5K → 20.3K)", () => {
    expect(
      resolveContextTokens({
        estimate: 239_500,
        provider: {
          inputTokens: 20_300,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(239_500)
  })

  it("falls back to estimate on inflated prompt_tokens", () => {
    expect(
      resolveContextTokens({
        estimate: 30_000,
        provider: {
          inputTokens: 900_000,
          outputTokens: 1_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(30_000)
  })

  it("after compact, small estimate wins over stale large provider", () => {
    // Compaction re-enters with small outbound; untrusted large provider is ignored.
    expect(
      resolveContextTokens({
        estimate: 2_788,
        provider: {
          inputTokens: 50_000,
          outputTokens: 2_000,
          cacheReadTokens: 900_000,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(2_788)
  })

  it("honors floor so mid-turn untrusted steps cannot yank the meter down", () => {
    expect(
      resolveContextTokens({
        estimate: 80_000,
        floor: 120_000,
        provider: {
          inputTokens: 20_000, // untrusted shadow vs estimate
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(120_000)
  })

  it("trusted provider can still grow above floor", () => {
    expect(
      resolveContextTokens({
        estimate: 100_000,
        floor: 80_000,
        provider: {
          inputTokens: 150_000,
          outputTokens: 5_000,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(155_000)
  })

  it("trusted provider may correct BELOW floor so effective and last* stay aligned", () => {
    // Without this, effective stays high while last* stores the lower real
    // total — next send rebuilds from last* and the meter appears to drop.
    expect(
      resolveContextTokens({
        estimate: 30_000,
        floor: 36_300,
        provider: {
          inputTokens: 28_000,
          outputTokens: 1_200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ).toBe(29_200)
  })
})

describe("streamStartContextTokens", () => {
  it("keeps previous occupancy when larger than outbound estimate", () => {
    // Send message: estimate of new outbound may under-count cache; keep previous.
    expect(streamStartContextTokens(62_000, 124_000)).toBe(124_000)
  })

  it("uses outbound estimate when larger (growth)", () => {
    expect(streamStartContextTokens(80_000, 50_000)).toBe(80_000)
  })

  it("after compact previous is small — estimate of compact msgs wins or ties", () => {
    expect(streamStartContextTokens(2_788, 2_788)).toBe(2_788)
    expect(streamStartContextTokens(3_000, 2_788)).toBe(3_000)
  })

  it("cold start with no previous uses estimate", () => {
    expect(streamStartContextTokens(4_000, 0)).toBe(4_000)
  })
})

describe("extractProviderStepUsage", () => {
  it("reads AI SDK inputTokenDetails.cacheReadTokens + noCacheTokens", () => {
    expect(
      extractProviderStepUsage({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        inputTokenDetails: {
          cacheReadTokens: 100,
          cacheWriteTokens: 5,
          noCacheTokens: 10,
        },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 100,
      cacheWriteTokens: 5,
      noCacheTokens: 10,
      totalTokens: 12,
    })
  })

  it("falls back to cachedInputTokens / promptCacheHitTokens", () => {
    expect(
      extractProviderStepUsage({
        inputTokens: 10,
        outputTokens: 0,
        cachedInputTokens: 50,
      })?.cacheReadTokens,
    ).toBe(50)
    expect(
      extractProviderStepUsage({
        inputTokens: 10,
        outputTokens: 0,
        promptCacheHitTokens: 77,
      })?.cacheReadTokens,
    ).toBe(77)
  })

  it("returns null for empty usage", () => {
    expect(extractProviderStepUsage({})).toBeNull()
    expect(extractProviderStepUsage(null)).toBeNull()
  })
})
