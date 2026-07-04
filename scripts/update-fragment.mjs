#!/usr/bin/env node
//
//   node scripts/update-fragment.mjs <platformKey> <artifactPath> <baseUrl> <outPath>
//   node scripts/update-fragment.mjs windows-x86_64 \
//     "src-tauri/target/.../Codezal_0.1.0_x64-setup.exe" \
//     "https://codezal.com/updates/" frag-windows.json
//
//   (windows-x86_64 | darwin-aarch64 | darwin-x86_64).
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

const [platformKey, artifactPath, baseUrl, outPath] = process.argv.slice(2)
if (!platformKey || !artifactPath || !baseUrl || !outPath) {
  console.error(
    "Kullanım: update-fragment.mjs <platformKey> <artifactPath> <baseUrl> <outPath>",
  )
  process.exit(1)
}

const signature = readFileSync(`${artifactPath}.sig`, "utf8").trim()
const url = `${baseUrl.replace(/\/+$/, "")}/${basename(artifactPath)}`

writeFileSync(outPath, JSON.stringify({ [platformKey]: { signature, url } }, null, 2))
console.log(`✓ fragment: ${platformKey} → ${url}`)
