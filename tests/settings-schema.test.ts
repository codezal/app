// Generates and drift-guards `src/lib/config/settings.schema.json`.
//
// The JSON Schema is derived from the exact same zod schema used to validate
// settings at runtime (makeSchema), so a hand-edited settings.json gets editor
// autocomplete + validation that can never disagree with the loader.
//
//   - normal run:        asserts the committed schema is in sync (fails on drift)
//   - UPDATE_SCHEMA=1:    regenerates and writes the committed schema
//
// Regenerate with: npm run schema
import { describe, it, expect } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { makeSchema } from "@/lib/config/schema"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"

const SCHEMA_PATH = fileURLToPath(new URL("../src/lib/config/settings.schema.json", import.meta.url))

function generate(): Record<string, unknown> {
  // "input" view: every field is `.catch(default)`, i.e. optional on input —
  // exactly what a hand-written settings.json should be allowed to omit.
  const body = z.toJSONSchema(makeSchema(DEFAULT_SETTINGS), { io: "input" }) as Record<string, unknown>
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "codezal-settings",
    title: "Codezal settings",
    description: "Schema for Codezal's settings.json. Generated from the runtime zod schema — edit src/lib/config/schema.ts and run `npm run schema`, do not hand-edit this file.",
    ...body,
  }
}

describe("settings.json JSON Schema", () => {
  it(process.env.UPDATE_SCHEMA ? "regenerates the committed schema" : "is in sync with the runtime zod schema", () => {
    const generated = generate()

    if (process.env.UPDATE_SCHEMA) {
      writeFileSync(SCHEMA_PATH, JSON.stringify(generated, null, 2) + "\n")
      return
    }

    let committed: unknown
    try {
      committed = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))
    } catch {
      throw new Error(`Missing or unreadable ${SCHEMA_PATH}. Run \`npm run schema\` to generate it.`)
    }
    // toEqual is key-order-insensitive, so formatting of the committed file is
    // irrelevant — only the structural content must match.
    expect(committed, "settings.schema.json is stale — run `npm run schema`").toEqual(generated)
  })
})
