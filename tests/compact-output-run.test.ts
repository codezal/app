import { describe, it, expect } from "vitest"
import { applyCompact } from "@/lib/token-savers/compact-output/run"
import type { CompactOutputSettings } from "@/lib/token-savers/types"

const ALL_ON: CompactOutputSettings = {
  enabled: true,
  filters: {
    git: true,
    test: true,
    build: true,
    grep: true,
    lint: true,
    pkg: true,
    generic: true,
  },
}

const ALL_OFF: CompactOutputSettings = {
  enabled: false,
  filters: {
    git: true,
    test: true,
    build: true,
    grep: true,
    lint: true,
    pkg: true,
    generic: true,
  },
}

function bigOutput(n: number): string {
  return Array.from({ length: n }, () => "Downloading... 50%").join("\n")
}

describe("applyCompact", () => {
  it("cfg.enabled: false → ham output", () => {
    const raw = "anything"
    expect(applyCompact("git status", raw, ALL_OFF)).toBe(raw)
  })

  it("filter devre dışıysa → ham output", () => {
    const cfg: CompactOutputSettings = { ...ALL_ON, filters: { ...ALL_ON.filters, git: false } }
    const raw = "git diff output"
    expect(applyCompact("git diff", raw, cfg)).toBe(raw)
  })

  it("küçük çıktı → footer yok", () => {
    const raw = "ok\nall tests passed"
    const r = applyCompact("vitest run", raw, ALL_ON)
    expect(r).not.toContain("[compacted:")
  })

  it("büyük tekrarlı çıktı → footer eklenir", () => {
    const raw = bigOutput(2000)
    const r = applyCompact("git status", raw, ALL_ON)
    expect(r).toContain("[compacted:")
  })

  it("footer filtre türünü içerir", () => {
    const raw = bigOutput(2000)
    const r = applyCompact("git log", raw, ALL_ON)
    if (r.includes("[compacted:")) {
      expect(r).toContain("filter=git")
    }
  })

  it("ANSI kodları sıyrılır", () => {
    const raw = "\x1b[31mfailed\x1b[0m\n\x1b[32mpassed\x1b[0m"
    const r = applyCompact("vitest run", raw, ALL_ON)
    expect(r).not.toContain("\x1b[")
  })

  it("git hint satırları düşürülür", () => {
    const raw = 'Changes not staged:\n  (use "git restore ...")\n  modified: foo.ts'
    const r = applyCompact("git status", raw, ALL_ON)
    expect(r).not.toContain("use \"git restore")
    expect(r).toContain("modified: foo.ts")
  })

  it("PASS tick'leri test çıktısından düşürülür", () => {
    const raw = "PASS src/foo.test.ts\nFAIL src/bar.test.ts"
    const r = applyCompact("vitest run", raw, ALL_ON)
    expect(r).not.toContain("PASS src/foo")
    expect(r).toContain("FAIL src/bar")
  })

  it("npm progress satırları düşürülür", () => {
    const raw = "Downloading foo@1.0.0\nadded 12 packages"
    const r = applyCompact("npm install", raw, ALL_ON)
    expect(r).not.toContain("Downloading")
  })

  it("footer byte formatı doğru — KB için", () => {
    const raw = bigOutput(3000)
    const r = applyCompact("git status", raw, ALL_ON)
    expect(r).toContain("[compacted:")
    expect(r).toMatch(/\d+(\.\d+)?KB/)
  })
})
