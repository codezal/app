// Provider/model fiyatlandırması — per million tokens USD.
// Yaklaşık değerler (Mayıs 2026). API değişirse güncellenmeli.

export type Pricing = {
  inputPerMTok: number
  outputPerMTok: number
  // Bazı providerlerda cache hit indirimi
  cacheReadPerMTok?: number
  cacheWritePerMTok?: number
}

const PRICING: Record<string, Pricing> = {
  // OpenAI
  "gpt-5.5": { inputPerMTok: 5.0, outputPerMTok: 20.0 },
  "gpt-5.5-pro": { inputPerMTok: 12.0, outputPerMTok: 60.0 },
  "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  "gpt-5.4-mini": { inputPerMTok: 0.25, outputPerMTok: 2.0 },
  "gpt-5.4-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  "gpt-5.3-codex": { inputPerMTok: 3.0, outputPerMTok: 12.0 },
  "gpt-5.2-codex": { inputPerMTok: 2.0, outputPerMTok: 8.0 },
  "o4-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },

  // Anthropic
  "claude-opus-4-7": { inputPerMTok: 15.0, outputPerMTok: 75.0, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  "claude-haiku-4-5": { inputPerMTok: 0.8, outputPerMTok: 4.0, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1.0 },

  // Google
  "gemini-3.1-pro": { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  "gemini-3.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-3.1-flash-lite": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },

  // DeepSeek
  "deepseek-v4-pro": { inputPerMTok: 0.7, outputPerMTok: 2.5, cacheReadPerMTok: 0.07 },
  "deepseek-v4-flash": { inputPerMTok: 0.2, outputPerMTok: 0.9, cacheReadPerMTok: 0.02 },
  // Legacy
  "deepseek-chat": { inputPerMTok: 0.2, outputPerMTok: 0.9, cacheReadPerMTok: 0.02 },
  "deepseek-reasoner": { inputPerMTok: 0.55, outputPerMTok: 2.19, cacheReadPerMTok: 0.055 },
}

export function pricingFor(model: string): Pricing | null {
  return PRICING[model] ?? null
}

export type UsageBreakdown = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

// USD maliyeti hesapla
export function costUsd(model: string, u: UsageBreakdown): number {
  const p = pricingFor(model)
  if (!p) return 0
  const million = 1_000_000
  const cacheRead = u.cacheRead ?? 0
  const cacheWrite = u.cacheWrite ?? 0
  const billableInput = Math.max(0, u.input - cacheRead - cacheWrite)
  return (
    (billableInput / million) * p.inputPerMTok +
    (u.output / million) * p.outputPerMTok +
    (cacheRead / million) * (p.cacheReadPerMTok ?? p.inputPerMTok) +
    (cacheWrite / million) * (p.cacheWritePerMTok ?? p.inputPerMTok)
  )
}

// Bağlam penceresi (context cap) — display için
export function contextCap(model: string): number {
  if (model.startsWith("claude-")) return 1_000_000 // sonnet 4.6 = 1M
  if (model.startsWith("gemini-")) return 2_000_000
  if (model.startsWith("gpt-5")) return 400_000
  if (model.startsWith("deepseek-v4")) return 1_000_000 // v4-pro/flash 1M
  if (model.startsWith("deepseek-")) return 128_000 // legacy chat/reasoner
  return 200_000
}

// Verilen provider için ucuz/hızlı compaction modeli.
// Compaction semantic özet işidir — frontier reasoning gerekmez.
export function compactionModelFor(provider: string): { provider: string; model: string } {
  switch (provider) {
    case "anthropic":
      return { provider: "anthropic", model: "claude-haiku-4-5" }
    case "openai":
      return { provider: "openai", model: "gpt-5.4-mini" }
    case "google":
      return { provider: "google", model: "gemini-3.5-flash" }
    case "deepseek":
      return { provider: "deepseek", model: "deepseek-v4-flash" }
    default:
      return { provider, model: "" }
  }
}
