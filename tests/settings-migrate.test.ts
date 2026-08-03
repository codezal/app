// Settings migration — v2 onboardingCompleted heuristic.
//
// Existing installs must never see the first-launch onboarding; fresh installs
// must. migrateSettings derives this from whether the loaded file carried real
// prior content (snapshotted before migrators mutate the object).
import { describe, it, expect } from "vitest"
import { migrateSettings, CURRENT_SCHEMA_VERSION } from "@/lib/config/migrate"

describe("migrateSettings — onboardingCompleted (v2)", () => {
  it("fresh install (empty file) → onboardingCompleted unset, so onboarding shows", () => {
    const out = migrateSettings({})
    expect(out.onboardingCompleted).toBeUndefined()
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("non-object input → fresh, unmarked", () => {
    expect(migrateSettings(null).onboardingCompleted).toBeUndefined()
    expect(migrateSettings(undefined).onboardingCompleted).toBeUndefined()
  })

  it("existing v1 install (real content) → onboardingCompleted true, skips onboarding", () => {
    const out = migrateSettings({ schemaVersion: 1, defaultProvider: "openai", language: "tr" })
    expect(out.onboardingCompleted).toBe(true)
  })

  it("pre-versioning install (no schemaVersion, real content) → onboardingCompleted true", () => {
    const out = migrateSettings({ language: "en", theme: "dark" })
    expect(out.onboardingCompleted).toBe(true)
  })

  it("respects an explicit onboardingCompleted=false on disk (half-finished onboarding)", () => {
    const out = migrateSettings({ schemaVersion: 1, language: "tr", onboardingCompleted: false })
    expect(out.onboardingCompleted).toBe(false)
  })

  it("appearance injected by v1 does not falsely mark a truly empty file as existing", () => {
    // migrateV1 adds `appearance` even to {}; the prior-content snapshot is taken
    // before migrators run, so an empty file stays unmarked.
    const out = migrateSettings({})
    expect(out.appearance).toBeDefined() // v1 ran
    expect(out.onboardingCompleted).toBeUndefined() // but not marked existing
  })
})

describe("migrateSettings — supervisor pool → roles (v4)", () => {
  it("maps the first enabled write-capable entry to worker and review entries to reviewer", () => {
    const out = migrateSettings({
      schemaVersion: 3,
      supervisor: {
        enabled: true,
        pool: [
          { id: "a", agentName: "general", enabled: true, engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5.4" } },
          { id: "b", agentName: "code-reviewer", enabled: true, engine: { kind: "sdk", providerId: "anthropic", modelId: "claude-sonnet-4-5" } },
          { id: "c", agentName: "general", enabled: false, engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5-mini" } },
        ],
      },
    })
    expect(out.supervisor).toMatchObject({
      enabled: true,
      roles: {
        worker: { provider: "openai", model: "gpt-5.4" },
        reviewer: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    })
    expect(out.supervisor).not.toHaveProperty("pool")
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("drops legacy pools entirely when nothing maps", () => {
    const out = migrateSettings({
      schemaVersion: 3,
      supervisor: {
        enabled: true,
        pool: [
          { id: "a", agentName: "general", enabled: false, engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5.4" } },
        ],
      },
    })
    expect(out.supervisor.roles).toEqual({})
    expect(out.supervisor).not.toHaveProperty("pool")
  })

  it("skips legacy acp/CLI pool entries (no provider/model mapping for role pins)", () => {
    const out = migrateSettings({
      schemaVersion: 3,
      supervisor: {
        enabled: true,
        pool: [
          { id: "a", agentName: "general", enabled: true, engine: { kind: "acp", providerId: "gemini-cli", modelId: "gemini-2.5-pro" } },
          { id: "b", agentName: "general", enabled: true, engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5.4" } },
        ],
      },
    })
    expect(out.supervisor.roles).toEqual({
      worker: { provider: "openai", model: "gpt-5.4" },
    })
  })

  it("keeps already-migrated files untouched", () => {
    const out = migrateSettings({
      schemaVersion: 4,
      supervisor: { enabled: true, roles: { worker: { provider: "openai", model: "gpt-5.4" } } },
    })
    expect(out.supervisor.roles).toEqual({ worker: { provider: "openai", model: "gpt-5.4" } })
  })

  it("M19: newer-build file keeps its higher schemaVersion (no backward re-stamp)", () => {
    // A file written by a NEWER build (schemaVersion > CURRENT) must not be
    // stamped back down — re-stamping would re-run migrators on already-
    // migrated data the next time the newer build loads it.
    const out = migrateSettings({ schemaVersion: CURRENT_SCHEMA_VERSION + 3, defaultModel: "x" })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 3)
  })
})
