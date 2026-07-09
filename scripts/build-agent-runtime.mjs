#!/usr/bin/env node
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { build } from "esbuild"

const outfile = "src-tauri/resources/lsp/agent-runtime/index.js"

mkdirSync(dirname(outfile), { recursive: true })

await build({
  entryPoints: ["src-agent-runtime/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
})

console.log(`✓ Agent runtime bundle hazır: ${outfile}`)
