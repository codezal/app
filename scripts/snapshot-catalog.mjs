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
//
// The script prints a change summary (new / removed / updated providers and
// models) comparing the previous snapshot with the freshly fetched data.
// When the env var SUMMARY_FILE is set, a Markdown summary is also written
// to that path (used by CI to populate the PR body).

import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const CATALOG_URL = "https://models.dev/api.json"
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(SCRIPT_DIR, "../src/lib/catalog-snapshot.json")
const SUMMARY_FILE = process.env.SUMMARY_FILE

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const res = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } })
if (!res.ok) {
  console.error(`models.dev fetch failed: HTTP ${res.status}`)
  process.exit(1)
}
const fresh = await res.json()
if (typeof fresh !== "object" || fresh === null) {
  console.error("models.dev: unexpected JSON shape")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Load previous snapshot (may not exist on first run)
// ---------------------------------------------------------------------------

/** @type {Record<string, any> | null} */
let prev = null
try {
  prev = JSON.parse(await readFile(OUT, "utf-8"))
} catch {
  // no previous snapshot — everything is new
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const providerIds = (d) => new Set(Object.keys(d ?? {}))
const modelIds = (d, pid) => new Set(Object.keys(d?.[pid]?.models ?? {}))

const freshProviders = providerIds(fresh)
const prevProviders = providerIds(prev)

const addedProviders = [...freshProviders].filter((p) => !prevProviders.has(p))
const removedProviders = [...prevProviders].filter((p) => !freshProviders.has(p))

let addedModels = 0
let removedModels = 0
let updatedModels = 0
/** @type {string[]} — up to 20 notable context-window changes */
const contextChanges = []

for (const pid of freshProviders) {
  const freshModels = modelIds(fresh, pid)
  const prevModels = modelIds(prev, pid)

  addedModels += [...freshModels].filter((m) => !prevModels.has(m)).length
  removedModels += [...prevModels].filter((m) => !freshModels.has(m)).length

  // Check context / limit changes on shared models
  for (const mid of freshModels) {
    if (!prevModels.has(mid)) continue
    const fm = fresh[pid].models[mid]
    const pm = prev[pid].models[mid]
    if (!fm || !pm) continue
    const changed =
      fm.limit?.context !== pm.limit?.context ||
      fm.limit?.output !== pm.limit?.output ||
      fm.limit?.input !== pm.limit?.input
    if (changed) {
      updatedModels++
      if (contextChanges.length < 20) {
        const label = `${pid}/${mid}`
        const oldCtx = pm.limit?.context ?? "?"
        const newCtx = fm.limit?.context ?? "?"
        contextChanges.push(`- \`${label}\`: context ${oldCtx} → ${newCtx}`)
      }
    }
  }
}

const totalProviders = freshProviders.size
const totalModels = Object.values(fresh).reduce(
  (sum, p) => sum + Object.keys(p?.models ?? {}).length,
  0,
)
const hasChanges =
  addedProviders.length > 0 ||
  removedProviders.length > 0 ||
  addedModels > 0 ||
  removedModels > 0 ||
  updatedModels > 0

// ---------------------------------------------------------------------------
// Write snapshot (minified — bundled data, not hand-edited)
// ---------------------------------------------------------------------------

await writeFile(OUT, JSON.stringify(fresh))

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

console.log(`Wrote ${OUT}`)
console.log(`  ${totalProviders} providers, ${totalModels} models`)
if (!prev) {
  console.log("  (no previous snapshot — first run)")
} else if (!hasChanges) {
  console.log("  No changes since last snapshot.")
} else {
  console.log("")
  console.log("  Changes:")
  if (addedProviders.length)
    console.log(`  + ${addedProviders.length} new providers: ${addedProviders.join(", ")}`)
  if (removedProviders.length)
    console.log(`  - ${removedProviders.length} removed providers: ${removedProviders.join(", ")}`)
  if (addedModels) console.log(`  + ${addedModels} new models`)
  if (removedModels) console.log(`  - ${removedModels} removed models`)
  if (updatedModels) console.log(`  ~ ${updatedModels} models with changed limits`)
  if (contextChanges.length) {
    console.log("")
    console.log("  Notable context-window changes:")
    for (const line of contextChanges) console.log(`  ${line}`)
  }
}

// ---------------------------------------------------------------------------
// Markdown summary for CI (PR body)
// ---------------------------------------------------------------------------

if (SUMMARY_FILE) {
  const lines = [
    `## Catalog sync — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `**${totalProviders}** providers · **${totalModels}** models`,
    "",
  ]
  if (!prev) {
    lines.push("First snapshot — no previous data to compare.")
  } else if (!hasChanges) {
    lines.push("No changes since last snapshot.")
  } else {
    if (addedProviders.length)
      lines.push(`### New providers (${addedProviders.length})`, addedProviders.map((p) => `- \`${p}\``).join("\n"), "")
    if (removedProviders.length)
      lines.push(`### Removed providers (${removedProviders.length})`, removedProviders.map((p) => `- \`${p}\``).join("\n"), "")
    lines.push("### Models", "")
    lines.push(`| | Count |`, `|---|---|`)
    if (addedModels) lines.push(`| Added | ${addedModels} |`)
    if (removedModels) lines.push(`| Removed | ${removedModels} |`)
    if (updatedModels) lines.push(`| Limits changed | ${updatedModels} |`)
    lines.push("")
    if (contextChanges.length) {
      lines.push("### Notable context-window changes", "", ...contextChanges, "")
    }
  }
  lines.push("---", "_Auto-generated by `scripts/snapshot-catalog.mjs`_")
  await writeFile(SUMMARY_FILE, lines.join("\n"))
  console.log(`\nSummary written to ${SUMMARY_FILE}`)
}
