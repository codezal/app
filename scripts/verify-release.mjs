#!/usr/bin/env node
// Verifies the published Tauri updater manifest and every platform artifact.
import { readFileSync } from "node:fs"

const REQUIRED_PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]
const DEFAULT_TIMEOUT_MS = 15_000

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function usage() {
  console.log(`Usage: node scripts/verify-release.mjs [options]

Options:
  --version <version>       Expected release version. Defaults to package.json.
  --manifest <url>          Manifest URL. Defaults to tauri.conf.json updater endpoint.
  --platform <key>          Required platform key. May be repeated.
  --timeout-ms <number>     Request timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --help                    Show this help.
`)
}

function parseArgs(argv) {
  const args = {
    expectedVersion: null,
    manifestUrl: null,
    platforms: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case "--help":
        usage()
        process.exit(0)
        break
      case "--version":
        args.expectedVersion = argv[++i]
        break
      case "--manifest":
        args.manifestUrl = argv[++i]
        break
      case "--platform":
        args.platforms.push(argv[++i])
        break
      case "--timeout-ms":
        args.timeoutMs = Number(argv[++i])
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number")
  }

  return args
}

function cacheBusted(url) {
  const parsed = new URL(url)
  parsed.searchParams.set("_", String(Date.now()))
  return parsed.toString()
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchManifest(url, timeoutMs) {
  const response = await fetchWithTimeout(
    cacheBusted(url),
    {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
    },
    timeoutMs,
  )

  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status} ${response.statusText}`)
  }

  return await response.json()
}

async function verifyArtifact(url, timeoutMs) {
  let response = await fetchWithTimeout(url, { method: "HEAD" }, timeoutMs)

  if (response.status === 405) {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          range: "bytes=0-0",
        },
      },
      timeoutMs,
    )
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Artifact request failed: ${response.status} ${response.statusText}`)
  }

  const length = response.headers.get("content-length")
  if (length !== null && Number(length) <= 0) {
    throw new Error("Artifact has an empty content-length")
  }

  return length ? Number(length) : null
}

function verifyManifestShape(manifest, expectedVersion, platformKeys) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest is not a JSON object")
  }

  if (manifest.version !== expectedVersion) {
    throw new Error(`Manifest version mismatch: expected ${expectedVersion}, got ${manifest.version}`)
  }

  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    throw new Error("Manifest is missing platforms")
  }

  for (const key of platformKeys) {
    const platform = manifest.platforms[key]
    if (!platform || typeof platform !== "object") {
      throw new Error(`Manifest is missing platform: ${key}`)
    }
    if (typeof platform.signature !== "string" || platform.signature.trim() === "") {
      throw new Error(`Platform has no signature: ${key}`)
    }
    if (typeof platform.url !== "string" || platform.url.trim() === "") {
      throw new Error(`Platform has no URL: ${key}`)
    }
    const parsedUrl = new URL(platform.url)
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`Platform URL must be http(s): ${key}`)
    }
    if (!parsedUrl.pathname.includes(expectedVersion)) {
      throw new Error(`Platform URL does not include version ${expectedVersion}: ${key}`)
    }
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2))
  const pkg = readJson("package.json")
  const tauriConfig = readJson("src-tauri/tauri.conf.json")
  const endpoint = tauriConfig.plugins?.updater?.endpoints?.[0]
  const expectedVersion = cli.expectedVersion ?? pkg.version
  const manifestUrl = cli.manifestUrl ?? endpoint
  const platformKeys = cli.platforms.length > 0 ? cli.platforms : REQUIRED_PLATFORMS

  if (!manifestUrl) {
    throw new Error("No manifest URL provided and no updater endpoint found")
  }

  console.log(`Verifying Codezal release ${expectedVersion}`)
  console.log(`Manifest: ${manifestUrl}`)

  const manifest = await fetchManifest(manifestUrl, cli.timeoutMs)
  verifyManifestShape(manifest, expectedVersion, platformKeys)

  for (const key of platformKeys) {
    const { url } = manifest.platforms[key]
    const length = await verifyArtifact(url, cli.timeoutMs)
    const size = length === null ? "unknown size" : `${(length / 1024 / 1024).toFixed(1)} MB`
    console.log(`OK ${key}: ${url} (${size})`)
  }

  console.log("Release manifest verified")
}

main().catch((error) => {
  console.error(`Release verification failed: ${error.message}`)
  process.exit(1)
})
