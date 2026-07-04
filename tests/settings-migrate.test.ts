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
