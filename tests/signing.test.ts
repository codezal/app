import { describe, it, expect } from "vitest"
import { canonicalManifest, enforceCuratedSignature } from "@/lib/plugins/signing"

describe("canonicalManifest", () => {
  it("signature alanı hariç tutulur", () => {
    const m = { name: "x", version: "1.0.0", signature: "abc123" }
    const out = JSON.parse(canonicalManifest(m))
    expect(out.signature).toBeUndefined()
  })

  it("signature yoksa olduğu gibi serialize edilir", () => {
    const m = { name: "x", version: "1.0.0" }
    const out = JSON.parse(canonicalManifest(m))
    expect(out.name).toBe("x")
  })

  it("object key'leri alfabetik sıralanır", () => {
    const m = { z: 1, a: 2, m: 3 }
    const raw = canonicalManifest(m)
    const keys = Object.keys(JSON.parse(raw))
    expect(keys).toEqual([...keys].sort())
  })

  it("iç içe objede key'ler de sıralanır", () => {
    const m = { author: { name: "Bob", email: "bob@x.com" } }
    const raw = canonicalManifest(m)
    expect(raw.indexOf('"email"')).toBeLessThan(raw.indexOf('"name"'))
  })

  it("dizi sırası korunur", () => {
    const m = { permissions: ["shell.exec", "filesystem.read", "network.fetch"] }
    const out = JSON.parse(canonicalManifest(m))
    expect(out.permissions).toEqual(["shell.exec", "filesystem.read", "network.fetch"])
  })

  it("dizi içindeki objeler de sıralanır", () => {
    const m = { items: [{ z: 1, a: 2 }] }
    const raw = canonicalManifest(m)
    const out = JSON.parse(raw)
    expect(Object.keys(out.items[0])).toEqual(["a", "z"])
  })

  it("whitespace yok (compact JSON)", () => {
    const m = { a: 1, b: 2 }
    const raw = canonicalManifest(m)
    expect(raw).not.toContain("  ")
    expect(raw).not.toContain("\n")
  })

  it("string, number, boolean değerler olduğu gibi geçer", () => {
    const m = { s: "hello", n: 42, b: true, nil: null }
    const out = JSON.parse(canonicalManifest(m))
    expect(out.s).toBe("hello")
    expect(out.n).toBe(42)
    expect(out.b).toBe(true)
    expect(out.nil).toBeNull()
  })

  it("gidiş-dönüş deterministik — aynı input → aynı çıktı", () => {
    const m = { z: 3, a: 1, b: [2, 1], c: { x: 9, d: 0 }, signature: "sig" }
    expect(canonicalManifest(m)).toBe(canonicalManifest(m))
  })

  it("farklı key sırası → aynı canonical çıktı", () => {
    const m1 = { b: 2, a: 1 }
    const m2 = { a: 1, b: 2 }
    expect(canonicalManifest(m1)).toBe(canonicalManifest(m2))
  })
})

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

async function signManifest(base: Record<string, unknown>) {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))
  const pubB64 = b64(pub)
  const data = new TextEncoder().encode(canonicalManifest(base))
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, data))
  return { pubB64, manifest: { ...base, signature: b64(sig) } }
}

const curated = { name: "x", version: "1.0.0", channel: "codezal-curated", verified: true }

describe("enforceCuratedSignature", () => {
  it("valid signature passes", async () => {
    const { pubB64, manifest } = await signManifest(curated)
    await expect(enforceCuratedSignature(manifest as never, pubB64)).resolves.toBeUndefined()
  })

  it("missing signature on curated blocks (H4)", async () => {
    await expect(
      enforceCuratedSignature(curated as never, "unused"),
    ).rejects.toThrow()
  })

  it("invalid (tampered) signature blocks (H4)", async () => {
    const { pubB64, manifest } = await signManifest(curated)
    const tampered = { ...manifest, description: "changed after signing" }
    await expect(enforceCuratedSignature(tampered as never, pubB64)).rejects.toThrow()
  })

  it("unsupported (garbage) signature blocks — attacker cannot force allow (H4)", async () => {
    await expect(
      enforceCuratedSignature(
        { ...curated, signature: "!!!" } as never,
        "unused",
      ),
    ).rejects.toThrow()
  })

  it("verified:false does NOT skip verification on curated (H4)", async () => {
    // The attacker-controlled `verified` flag must not opt out of the check.
    await expect(
      enforceCuratedSignature(
        { ...curated, verified: false } as never,
        "unused",
      ),
    ).rejects.toThrow()
  })
})
