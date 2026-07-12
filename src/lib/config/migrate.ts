// Versioned settings migration.
//
// A `schemaVersion` field tags the on-disk shape. On load we run every migrator
// whose target version is newer than the file's, in order, then stamp the file
// at CURRENT_SCHEMA_VERSION. Files written before versioning existed report
// version 0 and run the full chain.
//
// Migrators perform *legacy-shape transforms only* (renames, field relocations).
// Default-filling of missing fields is the schema's job (see schema.ts), so it
// is intentionally not done here.

import { DEFAULT_APPEARANCE } from "@/lib/theme"

export const CURRENT_SCHEMA_VERSION = 3

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// v0 → v1: fold the legacy top-level `theme` field and the legacy
// `appearance.customLight`/`customDark` overrides into the current appearance
// shape (mode + customsByPreset). Mirrors the one-time migration that used to
// run inline in the settings store's load().
function migrateV1(d: Record<string, unknown>): void {
  const appearance = isRecord(d.appearance) ? d.appearance : (d.appearance = {})

  // Legacy top-level `theme` seeds appearance.mode when mode is absent.
  if (appearance.mode == null && typeof d.theme === "string") {
    appearance.mode = d.theme
  }

  const lightId =
    typeof appearance.lightPreset === "string" ? appearance.lightPreset : DEFAULT_APPEARANCE.lightPreset
  const darkId =
    typeof appearance.darkPreset === "string" ? appearance.darkPreset : DEFAULT_APPEARANCE.darkPreset

  const byPreset = isRecord(appearance.customsByPreset)
    ? appearance.customsByPreset
    : (appearance.customsByPreset = {})

  if (isRecord(appearance.customLight) && !byPreset[lightId]) byPreset[lightId] = appearance.customLight
  if (isRecord(appearance.customDark) && !byPreset[darkId]) byPreset[darkId] = appearance.customDark
  delete appearance.customLight
  delete appearance.customDark
}

// Context passed to every migrator: signals derived from the *original* file
// shape, captured before any migrator mutates `data`.
type MigrateCtx = {
  // True when the loaded file carried real prior settings (any key other than
  // schemaVersion). Distinguishes an upgrading install from a fresh one.
  hadPriorContent: boolean
}

// v1 → v2: existing installs must not see the first-launch onboarding. If the
// file came from a prior install (had real content) and onboardingCompleted was
// never written, mark it complete. Fresh installs (empty file) are left untouched
// so the schema default (false) lets the Onboarding overlay show.
function migrateV2(d: Record<string, unknown>, ctx: MigrateCtx): void {
  if (d.onboardingCompleted === undefined && ctx.hadPriorContent) {
    d.onboardingCompleted = true
  }
}

const MIGRATORS: { to: number; run: (d: Record<string, unknown>, ctx: MigrateCtx) => void }[] = [
  { to: 1, run: migrateV1 },
  { to: 2, run: migrateV2 },
]

// Apply legacy-shape migrations to raw settings data. Returns a new object
// stamped at CURRENT_SCHEMA_VERSION. Non-object input becomes an empty,
// freshly-versioned object (the schema then fills defaults).
export function migrateSettings(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return { schemaVersion: CURRENT_SCHEMA_VERSION }

  const data = structuredClone(raw)
  const from = typeof data.schemaVersion === "number" ? data.schemaVersion : 0
  // Snapshot prior-content BEFORE migrators run — migrateV1 injects `appearance`
  // into even an empty file, which would otherwise look like prior content.
  const ctx: MigrateCtx = {
    hadPriorContent: Object.keys(data).some((k) => k !== "schemaVersion"),
  }
  for (const m of MIGRATORS) {
    if (from < m.to) m.run(data, ctx)
  }
  data.schemaVersion = CURRENT_SCHEMA_VERSION
  return data
}
