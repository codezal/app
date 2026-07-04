#!/usr/bin/env node
//
//   node scripts/update-manifest.mjs <fragmentsDir> <outPath>
//   node scripts/update-manifest.mjs ./frags ./latest.json
//
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const [fragmentsDir, outPath] = process.argv.slice(2)
if (!fragmentsDir || !outPath) {
  console.error("Kullanım: update-manifest.mjs <fragmentsDir> <outPath>")
  process.exit(1)
}

const { version } = JSON.parse(readFileSync("package.json", "utf8"))

const platforms = {}
const files = readdirSync(fragmentsDir).filter((f) => f.endsWith(".json"))
if (files.length === 0) {
  console.error(`✗ ${fragmentsDir} içinde fragment (*.json) yok`)
  process.exit(1)
}
for (const f of files) {
  Object.assign(platforms, JSON.parse(readFileSync(join(fragmentsDir, f), "utf8")))
}

const manifest = {
  version,
  notes: process.env.RELEASE_NOTES || "",
  pub_date: new Date().toISOString(),
  platforms,
}

writeFileSync(outPath, JSON.stringify(manifest, null, 2))
console.log(`✓ latest.json (v${version}) → ${Object.keys(platforms).join(", ")}`)
