// Plugin signature verification — Ed25519 over a canonical manifest.
//
// Why: SHA pinning stops the *upstream* repo from changing under a pinned
// commit, but the marketplace index itself is the trust root — whoever can push
// to the marketplace can rewrite `source.sha`, escalate `permissions`, or swap
// `network.allowedHosts`. A maintainer-held signing key closes that gap: the
// app ships the Codezal public key, every curated manifest carries an Ed25519
// signature over its canonical bytes, and install verifies it before fetching
// anything. A compromised marketplace cannot forge a valid signature.
//
// Trust model
// -----------
// - The signing private key never ships and never enters the repo. The
//   marketplace tooling (scripts/sign-plugin.mjs) signs manifests locally.
// - Only the public key is embedded here (CODEZAL_SIGNING_PUBKEY).
// - Enforcement is scoped to curated + verified plugins. Community plugins are
//   already "use at your own risk" and are not required to sign.
//
// Rollout posture (current)
// --------------------------
// - signature present + verifies  → "valid"   (allow)
// - signature present + mismatch   → "invalid" (BLOCK — tampering)
// - signature present + crypto N/A → "unsupported" (WARN, allow — avoid
//   bricking installs on webviews lacking Ed25519; tighten later)
// - signature absent on curated    → "missing" (WARN, allow during rollout)
//
// When signing coverage is complete across the curated channel, the caller can
// flip "missing"/"unsupported" from warn to block.

import type { MarketplacePluginManifest } from "./types"

// Codezal marketplace signing public key — Ed25519 raw (32 bytes), base64.
// Private counterpart lives only on the maintainer's machine (see marketplace
// repo scripts/). Rotating this key invalidates all prior signatures.
export const CODEZAL_SIGNING_PUBKEY = "9dU1jhWF1NyZ9ul85mG2Ve/AWAQ+wJ1mX3d5SBC+Zk4="

export type VerifyResult = "valid" | "invalid" | "unsupported" | "missing"

// Deterministic canonical serialization. MUST match the marketplace signing
// script byte-for-byte. Rules:
// - object keys sorted lexicographically, recursively
// - the top-level `signature` field is excluded
// - arrays keep order
// - no insignificant whitespace
export function canonicalManifest(manifest: Record<string, unknown>): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue)
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(src).sort()) {
        out[k] = sortValue(src[k])
      }
      return out
    }
    return v
  }
  const clone: Record<string, unknown> = { ...manifest }
  delete clone.signature
  return JSON.stringify(sortValue(clone))
}

// base64 → Uint8Array (browser-safe, no Buffer).
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Verify the manifest's Ed25519 signature against the embedded public key.
// Never throws — crypto failures collapse to "unsupported".
export async function verifyManifestSignature(
  manifest: MarketplacePluginManifest,
  pubKeyB64: string = CODEZAL_SIGNING_PUBKEY,
): Promise<VerifyResult> {
  const sig = manifest.signature
  if (!sig || typeof sig !== "string") return "missing"

  const subtle = globalThis.crypto?.subtle
  if (!subtle) return "unsupported"

  try {
    const pubBytes = b64ToBytes(pubKeyB64)
    const sigBytes = b64ToBytes(sig)
    const dataBytes = new TextEncoder().encode(
      canonicalManifest(manifest as unknown as Record<string, unknown>),
    )
    const key = await subtle.importKey(
      "raw",
      pubBytes as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    )
    const ok = await subtle.verify(
      { name: "Ed25519" },
      key,
      sigBytes as unknown as BufferSource,
      dataBytes as unknown as BufferSource,
    )
    return ok ? "valid" : "invalid"
  } catch (e) {
    // Ed25519 unsupported in this webview, or malformed key/sig → cannot verify.
    console.warn("[signing] Ed25519 verify unavailable:", (e as Error).message)
    return "unsupported"
  }
}
