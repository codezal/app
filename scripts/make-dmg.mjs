#!/usr/bin/env node
//
//
//   APPLE_SIGNING_IDENTITY  "Developer ID Application: Ad (TEAMID)"
//   APPLE_NOTARY_PROFILE    notarytool keychain profili (local) — ya da:
//   APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID   (CI)
//
import appdmg from "appdmg"
import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs"

const triple = process.argv[2] || "aarch64-apple-darwin"
const arch = triple.startsWith("aarch64") ? "aarch64" : "x64"
const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version
const base = `src-tauri/target/${triple}/release/bundle`
const appPath = `${base}/macos/Codezal.app`
const dmgDir = `${base}/dmg`
const out = `${dmgDir}/Codezal_${version}_${arch}.dmg`

const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || ""
const NOTARY_PROFILE = process.env.APPLE_NOTARY_PROFILE || ""
const ENTITLEMENTS = "src-tauri/entitlements.plist"

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" })
}

if (!existsSync(appPath)) {
  console.error(`❌ .app yok: ${appPath}`)
  console.error(`   Önce: npm run tauri build -- --bundles app --target ${triple}`)
  process.exit(1)
}
mkdirSync(dmgDir, { recursive: true })
if (existsSync(out)) rmSync(out)

if (IDENTITY) {
  console.log("→ .app yeniden imzalanıyor…")
  run("codesign", [
    "--force", "--options", "runtime",
    "--entitlements", ENTITLEMENTS, "--timestamp",
    "--sign", IDENTITY, appPath,
  ])
}

console.log(`→ DMG üretiliyor: ${out}`)
await new Promise((resolve, reject) => {
  const ee = appdmg({
    target: out,
    basepath: ".",
    specification: {
      title: "Codezal",
      icon: "src-tauri/icons/icon.icns",
      background: "src-tauri/dmg-background.png", // @2x otomatik bulunur
      "icon-size": 128,
      window: { size: { width: 660, height: 400 } },
      contents: [
        { x: 180, y: 200, type: "file", path: appPath }, // Codezal sol
        { x: 480, y: 200, type: "link", path: "/Applications" },
      ],
    },
  })
  ee.on("progress", (i) => console.log(`  [${i.current}/${i.total}] ${i.title}`))
  ee.on("finish", resolve)
  ee.on("error", reject)
})
console.log("✓ DMG üretildi")

// ── 4. DMG imzala ──
if (IDENTITY) {
  console.log("→ DMG imzalanıyor…")
  run("codesign", ["--force", "--timestamp", "--sign", IDENTITY, out])
}

// ── 5. Notarize + staple ──
const notaryArgs = NOTARY_PROFILE
  ? ["--keychain-profile", NOTARY_PROFILE]
  : process.env.APPLE_ID
    ? [
        "--apple-id", process.env.APPLE_ID,
        "--password", process.env.APPLE_PASSWORD,
        "--team-id", process.env.APPLE_TEAM_ID,
      ]
    : null

if (IDENTITY && notaryArgs) {
  console.log("→ Notarize ediliyor (Apple'a gönderiliyor, birkaç dakika)…")
  run("xcrun", ["notarytool", "submit", out, ...notaryArgs, "--wait"])
  console.log("→ Staple ediliyor…")
  run("xcrun", ["stapler", "staple", out])
  console.log("✓ Notarized + stapled")
} else if (IDENTITY) {
  console.log("⚠ İmzalandı ama notarize edilmedi (APPLE_NOTARY_PROFILE / APPLE_ID yok)")
}

console.log(`✓ DMG hazır: ${out}`)
