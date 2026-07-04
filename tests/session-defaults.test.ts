import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/providers", () => ({
  modelsFor: vi.fn(),
  defaultModelFor: vi.fn(),
}))

import { resolveSessionDefaults } from "@/lib/session-defaults"
import { modelsFor, defaultModelFor } from "@/lib/providers"
import type { Settings, ProjectMeta } from "@/store/types"

const settings = {
  defaultProvider: "deepseek",
  defaultModel: "deepseek-v4",
  providerCatalog: { data: {} },
  modelStatus: {},
} as unknown as Settings

const meta = (m: Partial<ProjectMeta>): ProjectMeta => m as ProjectMeta

beforeEach(() => {
  vi.mocked(modelsFor).mockReset()
  vi.mocked(defaultModelFor).mockReset()
})

describe("resolveSessionDefaults", () => {
  it("meta yoksa global default döner", () => {
    expect(resolveSessionDefaults(undefined, settings)).toEqual({
      provider: "deepseek",
      model: "deepseek-v4",
    })
  })

  it("hatırlanan model geçerliyse (listede) onu döner", () => {
    vi.mocked(modelsFor).mockReturnValue(["kimi-k2.6", "kimi-k2.5"])
    expect(
      resolveSessionDefaults(meta({ defaultProvider: "moonshot", defaultModel: "kimi-k2.6" }), settings),
    ).toEqual({ provider: "moonshot", model: "kimi-k2.6" })
  })

  it("liste boşsa (doğrulanamaz) hatırlanan çifte güvenir", () => {
    vi.mocked(modelsFor).mockReturnValue([])
    expect(
      resolveSessionDefaults(meta({ defaultProvider: "custom-x", defaultModel: "foo" }), settings),
    ).toEqual({ provider: "custom-x", model: "foo" })
  })

  it("model stale ama provider tanınıyor → provider korunur, default modeline düşer", () => {
    vi.mocked(modelsFor).mockReturnValue(["kimi-k2.6"])
    vi.mocked(defaultModelFor).mockReturnValue("kimi-k2.6")
    expect(
      resolveSessionDefaults(meta({ defaultProvider: "moonshot", defaultModel: "k2p6-old" }), settings),
    ).toEqual({ provider: "moonshot", model: "kimi-k2.6" })
    // GLOBAL provider'a (deepseek) ATLAMADI.
  })

  it("model stale + provider da yok (default boş) → global default'a düşer", () => {
    vi.mocked(modelsFor).mockReturnValue(["x"])
    vi.mocked(defaultModelFor).mockReturnValue("")
    expect(
      resolveSessionDefaults(meta({ defaultProvider: "ghost", defaultModel: "dead" }), settings),
    ).toEqual({ provider: "deepseek", model: "deepseek-v4" })
  })
})
