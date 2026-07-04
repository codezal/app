#!/usr/bin/env node
//   package.json · src-tauri/tauri.conf.json · src-tauri/Cargo.toml
//
//
//   npm run bump 0.1.0-beta.2 --tag    # ek olarak git tag v0.1.0-beta.2 atar (push ETMEZ)
//
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const version = process.argv[2]
const doTag = process.argv.includes("--tag")

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
if (!version || !SEMVER.test(version)) {
  console.error(`✗ Geçersiz sürüm: "${version ?? ""}"`)
  console.error('  Örnek: npm run bump 0.1.0-beta.2 [--tag]')
  process.exit(1)
}

const FILES = []

function patch(path, regex, replacement) {
  const src = readFileSync(path, "utf8")
  if (!regex.test(src)) {
    console.error(`✗ Sürüm satırı bulunamadı: ${path}`)
    process.exit(1)
  }
  writeFileSync(path, src.replace(regex, replacement))
  FILES.push(path)
  console.log(`  ✓ ${path}`)
}

console.log(`→ Sürüm ${version} olarak ayarlanıyor`)

patch("package.json", /"version":\s*"[^"]*"/, `"version": "${version}"`)

patch("src-tauri/tauri.conf.json", /"version":\s*"[^"]*"/, `"version": "${version}"`)

patch("src-tauri/Cargo.toml", /^version\s*=\s*"[^"]*"/m, `version = "${version}"`)

if (doTag) {
  const tag = `v${version}`
  console.log(`→ Sürüm commit'leniyor + tag ${tag}`)
  execFileSync("git", ["commit", "-m", `chore: bump ${version}`, "--", ...FILES], {
    stdio: "inherit",
  })
  execFileSync("git", ["tag", tag], { stdio: "inherit" })
  console.log(`  ✓ ${tag} (push: git push origin HEAD ${tag})`)
}

console.log("✓ Bitti")
