import { describe, it, expect } from "vitest"
import { canonicalManifest } from "@/lib/plugins/signing"

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
