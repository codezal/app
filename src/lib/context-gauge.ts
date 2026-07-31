// Single source of truth for the context-window occupancy number shown in the
// composer gauge and used by auto-compaction.
//
// Design:
//   1. Local estimate of the request we actually send is always available.
//   2. Provider step usage is accepted only when it is consistent with that
//      estimate — neither inflated (cumulative cache folded into prompt_tokens)
//      nor deflated (cache-miss slice only, cacheRead omitted).
//   3. Billing counters (cumulative input/output/cost) never drive the gauge.
//   4. Compaction stamps a fresh estimate and clears last-step provider fields
//      so a pre-compact full-window number cannot resurrect.
//   5. Provider totals never double-count cache: AI SDK `inputTokens` already
//      includes cache on most providers; only miss-only reports add cache back.

/** Ignore provider totals above this multiple of the local estimate. */
export const PROMPT_TOKEN_TRUST_HIGH = 6

/**
 * Ignore provider totals below this fraction of the local estimate when the
 * provider also reported no cacheRead — the classic "cache-miss shadow" that
 * collapses 239K → 20K the moment a step ends.
 */
export const PROMPT_TOKEN_TRUST_LOW = 0.5

export type ProviderStepUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Non-cached input slice when the provider exposes the breakdown. */
  noCacheTokens: number
  /** AI SDK totalTokens (input+output) when present. */
  totalTokens: number
}

export type ResolveContextTokensInput = {
  /** Local estimate of tokens in the request on the wire (or post-compact msgs). */
  estimate: number
  /** Provider-reported last-step usage, when available. */
  provider?: Partial<ProviderStepUsage> | null
  /**
   * Floor that the resolved value must not fall below (e.g. previous trusted
   * gauge within the same turn). Prevents mid-turn flicker when a later step
   * briefly reports a deflated total that still passes the estimate gate.
   */
  floor?: number
}

function nonNeg(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Pull cache / token fields out of an AI SDK usage-like object. */
export function extractProviderStepUsage(usage: unknown): ProviderStepUsage | null {
  if (!usage || typeof usage !== "object") return null
  const u = usage as Record<string, unknown>
  const details =
    u.inputTokenDetails && typeof u.inputTokenDetails === "object"
      ? (u.inputTokenDetails as Record<string, unknown>)
      : null

  const inputTokens = nonNeg(u.inputTokens)
  const outputTokens = nonNeg(u.outputTokens)
  const cacheReadTokens = nonNeg(
    details?.cacheReadTokens ?? u.cachedInputTokens ?? u.promptCacheHitTokens ?? u.cacheReadTokens,
  )
  const cacheWriteTokens = nonNeg(
    details?.cacheWriteTokens ?? u.cacheWriteTokens ?? u.promptCacheWriteTokens,
  )
  const noCacheTokens = nonNeg(details?.noCacheTokens ?? u.noCacheTokens)
  const totalTokens = nonNeg(u.totalTokens)

  if (
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + noCacheTokens + totalTokens <=
    0
  ) {
    return null
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    noCacheTokens,
    totalTokens,
  }
}

/**
 * Context occupancy implied by one provider step — without double-counting cache.
 *
 * AI SDK semantics (v6 LanguageModelUsage):
 *   - `inputTokens` = total prompt tokens (cache-inclusive on most providers)
 *   - `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` are subsets
 *   - `inputTokenDetails.noCacheTokens` is the miss slice
 *   - `totalTokens` ≈ input + output when present
 *
 * Some providers (Qwen/Alibaba) only put the miss slice in `inputTokens` and
 * expose cache separately — detected when input < cacheRead (+ optional write).
 *
 * Output is included because the assistant reply lands in history and becomes
 * part of the next request's prompt.
 */
export function providerContextTotal(provider: Partial<ProviderStepUsage>): number {
  const input = nonNeg(provider.inputTokens)
  const output = nonNeg(provider.outputTokens)
  const cacheRead = nonNeg(provider.cacheReadTokens)
  const cacheWrite = nonNeg(provider.cacheWriteTokens)
  const noCache = nonNeg(provider.noCacheTokens)
  const reportedTotal = nonNeg(provider.totalTokens)

  // Prefer explicit breakdown when noCache is present — no ambiguity.
  if (noCache > 0 || (cacheRead > 0 && noCache === 0 && input > 0 && input < cacheRead)) {
    // noCache path OR clear miss-only input (input < cacheRead).
    if (noCache > 0) {
      return noCache + cacheRead + cacheWrite + output
    }
    // Miss-only inputTokens: add cache components.
    return input + cacheRead + cacheWrite + output
  }

  // inputTokens already includes cache (standard AI SDK / Anthropic / OpenAI).
  if (input > 0) {
    return input + output
  }

  // Fallbacks when input is missing.
  if (reportedTotal > 0) return reportedTotal
  if (cacheRead + cacheWrite > 0) return cacheRead + cacheWrite + output
  return output
}

/**
 * Reconstruct last-step total from persisted session usage fields.
 * Returns 0 when last* were cleared (e.g. after compaction).
 */
export function lastStepTotalTokens(usage: {
  lastInputTokens?: number
  lastOutputTokens?: number
  lastCacheReadTokens?: number
  lastCacheWriteTokens?: number
} | null | undefined): number {
  if (!usage) return 0
  return providerContextTotal({
    inputTokens: usage.lastInputTokens,
    outputTokens: usage.lastOutputTokens,
    cacheReadTokens: usage.lastCacheReadTokens,
    cacheWriteTokens: usage.lastCacheWriteTokens,
  })
}

/**
 * Decide whether a provider-reported total is trustworthy relative to our
 * local estimate of the same request.
 *
 * - Inflated (provider ≫ estimate): MiniMax-style cumulative cache accounting.
 * - Deflated (provider ≪ estimate, no cacheRead): Qwen-style cache-miss only.
 */
export function isTrustworthyProviderTotal(
  providerTotal: number,
  estimate: number,
  cacheReadTokens = 0,
): boolean {
  const prov = nonNeg(providerTotal)
  const est = nonNeg(estimate)
  if (prov <= 0) return false
  if (est <= 0) return true
  if (prov > est * PROMPT_TOKEN_TRUST_HIGH) return false
  if (cacheReadTokens <= 0 && prov < est * PROMPT_TOKEN_TRUST_LOW) return false
  return true
}

/**
 * Single resolver for gauge + compaction occupancy.
 *
 * Prefer a trustworthy provider total (real tokenizer + cache occupancy).
 * Otherwise fall back to the local estimate. Never invent a blend that could
 * flicker between the two.
 *
 * `floor` only protects against untrusted / missing provider reports — a
 * trusted provider total is allowed to move the meter down (otherwise
 * effective stays high while last* stores the lower real total, and the next
 * send appears to "drop" when stream-start rebuilds from last*).
 */
export function resolveContextTokens(input: ResolveContextTokensInput): number {
  const estimate = nonNeg(input.estimate)
  const floor = nonNeg(input.floor)
  const provider = input.provider
  if (!provider) return Math.max(estimate, floor)

  const cacheRead = nonNeg(provider.cacheReadTokens)
  const total = providerContextTotal(provider)
  if (total > 0 && isTrustworthyProviderTotal(total, estimate, cacheRead)) {
    return total
  }
  const fallback = estimate > 0 ? estimate : total
  return Math.max(fallback, floor)
}

/**
 * Occupancy at stream start — before any step has reported usage for this turn.
 *
 * Uses max(estimate of outbound prompt, previous trusted occupancy). The max
 * keeps the meter from collapsing to a cache-blind text guess the instant the
 * user hits send, while still allowing compaction (which stamps a small
 * previous) to show the post-compact size immediately.
 */
export function streamStartContextTokens(
  estimatedOutbound: number,
  previousOccupancy?: number | null,
): number {
  const estimate = nonNeg(estimatedOutbound)
  const previous = nonNeg(previousOccupancy)
  return Math.max(estimate, previous)
}
