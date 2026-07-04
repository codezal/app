#!/usr/bin/env node
// Build-time snapshot of the models.dev provider/model catalog.
//
// The app fetches https://models.dev/api.json at runtime (cached in settings),
// but a fresh install with no network — or a first launch before the first
// fetch resolves — has no catalog at all, which hides every catalog-derived
// provider and all live model lists. This script commits a snapshot that ships
// in the bundle as an offline seed; the runtime fetch still replaces it with
// fresh data whenever the app is online (the seed is marked stale on load).
//
// Run: npm run snapshot:catalog   (re-run periodically to refresh the seed)

import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const CATALOG_URL = "https://models.dev/api.json"
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/lib/catalog-snapshot.json",
)

const res = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } })
if (!res.ok) {
  console.error(`models.dev fetch failed: HTTP ${res.status}`)
  process.exit(1)
}
const data = await res.json()
if (typeof data !== "object" || data === null) {
  console.error("models.dev: unexpected JSON shape")
  process.exit(1)
}

const providerCount = Object.keys(data).length
const modelCount = Object.values(data).reduce(
  (sum, p) => sum + Object.keys(p?.models ?? {}).length,
  0,
)

// Minified — this is bundled data, not hand-edited; keeping it compact reduces
// both the committed size and the shipped bundle.
await writeFile(OUT, JSON.stringify(data))
console.log(`Wrote ${OUT}`)
console.log(`  ${providerCount} providers, ${modelCount} models`)
