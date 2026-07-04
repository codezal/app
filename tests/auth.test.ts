import { describe, it, expect } from "vitest"
import { isConnectedSync, activeAuthLabel } from "@/lib/providers/auth"
import type { ProviderInfo } from "@/lib/providers/types"
import type { Settings } from "@/store/types"

function provider(id: string, envVars: string[] = []): ProviderInfo {
  return {
    id: id as ProviderInfo["id"],
    label: id,
    authMethods: ["apiKey", "env", "oauth"],
    envVars,
    npmPackage: "",
    requiresConfig: false,
    defaultModel: "",
    fallbackModels: [],
    buildLanguageModel: async () => { throw new Error("mock") },
  }
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { envFallback: false, ...overrides } as unknown as Settings
}

// ─── isConnectedSync ──────────────────────────────────────────────────────────

describe("isConnectedSync", () => {
  it("apiKey varsa → bağlı", () => {
    const s = settings({ apiKeys: { openai: "sk-test" } })
    expect(isConnectedSync(provider("openai"), s)).toBe(true)
  })

  it("apiKey yoksa → bağlı değil", () => {
    expect(isConnectedSync(provider("openai"), settings())).toBe(false)
  })

  it("keyless provider → bağlı", () => {
    expect(isConnectedSync({ ...provider("mlx"), keyless: true }, settings())).toBe(true)
  })

  it("apiKey boş string → bağlı değil", () => {
    const s = settings({ apiKeys: { openai: "" } })
    expect(isConnectedSync(provider("openai"), s)).toBe(false)
  })

  it("oauth credential varsa → bağlı", () => {
    const s = settings({
      credentials: { github: { accessToken: "gho_xxx", kind: "oauth" } },
    })
    expect(isConnectedSync(provider("github"), s)).toBe(true)
  })

  it("oauth credential accessToken yoksa → bağlı değil", () => {
    const s = settings({ credentials: { github: { kind: "oauth" } } })
    expect(isConnectedSync(provider("github"), s)).toBe(false)
  })

  it("envFallback true + envHit → bağlı", () => {
    const s = settings({ envFallback: true })
    expect(isConnectedSync(provider("openai", ["OPENAI_API_KEY"]), s, { OPENAI_API_KEY: true })).toBe(true)
  })

  it("envFallback false + envHit → bağlı değil", () => {
    const s = settings({ envFallback: false })
    expect(isConnectedSync(provider("openai", ["OPENAI_API_KEY"]), s, { OPENAI_API_KEY: true })).toBe(false)
  })

  it("envFallback true + envHit yoksa → bağlı değil", () => {
    const s = settings({ envFallback: true })
    expect(isConnectedSync(provider("openai", ["OPENAI_API_KEY"]), s, {})).toBe(false)
  })
})

// ─── activeAuthLabel ─────────────────────────────────────────────────────────

describe("activeAuthLabel", () => {
  it("apiKey → 'apiKey'", () => {
    const s = settings({ apiKeys: { openai: "sk-xxx" } })
    expect(activeAuthLabel(provider("openai"), s, {})).toBe("apiKey")
  })

  it("oauth credential → 'oauth'", () => {
    const s = settings({
      credentials: { github: { accessToken: "gho_xxx", kind: "oauth" } },
    })
    expect(activeAuthLabel(provider("github"), s, {})).toBe("oauth")
  })

  it("env fallback → 'env'", () => {
    const s = settings({ envFallback: true })
    expect(
      activeAuthLabel(provider("openai", ["OPENAI_API_KEY"]), s, { OPENAI_API_KEY: true }),
    ).toBe("env")
  })

  it("hiçbiri yok → null", () => {
    expect(activeAuthLabel(provider("openai"), settings(), {})).toBeNull()
  })

  it("apiKey önce gelir (oauth da olsa)", () => {
    const s = settings({
      apiKeys: { openai: "sk-xxx" },
      credentials: { openai: { accessToken: "tok", kind: "oauth" } },
    })
    expect(activeAuthLabel(provider("openai"), s, {})).toBe("apiKey")
  })
})
