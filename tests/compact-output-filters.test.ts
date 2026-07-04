import { describe, it, expect } from "vitest"
import { stripAnsi, dedupeRuns, genericFilter } from "@/lib/token-savers/compact-output/filters/generic"
import { testFilter } from "@/lib/token-savers/compact-output/filters/test"
import { gitFilter } from "@/lib/token-savers/compact-output/filters/git"
import { lintFilter } from "@/lib/token-savers/compact-output/filters/lint"
import { buildFilter } from "@/lib/token-savers/compact-output/filters/build"
import { grepFilter } from "@/lib/token-savers/compact-output/filters/grep"
import { pkgFilter } from "@/lib/token-savers/compact-output/filters/pkg"
import { detect } from "@/lib/token-savers/compact-output/detect"

// ─── generic ─────────────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("ANSI renk kodu sıyrılır", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m")).toBe("error")
  })

  it("iç içe ANSI sıyrılır", () => {
    expect(stripAnsi("\x1b[1;32mok\x1b[0m")).toBe("ok")
  })

  it("ANSI yoksa olduğu gibi döner", () => {
    expect(stripAnsi("plain text")).toBe("plain text")
  })

  it("boş string → boş string", () => {
    expect(stripAnsi("")).toBe("")
  })
})

describe("dedupeRuns", () => {
  it("tekil satırlar değişmez", () => {
    expect(dedupeRuns("a\nb\nc")).toBe("a\nb\nc")
  })

  it("2× tekrar → '(× 2)' suffix", () => {
    expect(dedupeRuns("x\nx")).toBe("x (× 2)")
  })

  it("5× tekrar → tek satır + sayı", () => {
    const r = dedupeRuns("a\na\na\na\na")
    expect(r).toBe("a (× 5)")
  })

  it("farklı satırlar arasındaki tekrar ayrı gruplanır", () => {
    const r = dedupeRuns("a\na\nb\nb\nb")
    expect(r).toContain("a (× 2)")
    expect(r).toContain("b (× 3)")
  })

  it("boş → boş", () => {
    expect(dedupeRuns("")).toBe("")
  })
})

describe("genericFilter", () => {
  it("ANSI + dedupe birlikte uygulanır", () => {
    const r = genericFilter("\x1b[32mok\x1b[0m\n\x1b[32mok\x1b[0m")
    expect(r).toBe("ok (× 2)")
  })
})

// ─── testFilter ───────────────────────────────────────────────────────────────

describe("testFilter", () => {
  it("PASS tick satırları düşürülür", () => {
    const r = testFilter("PASS src/foo.test.ts\nsome result")
    expect(r).not.toContain("PASS src/foo")
  })

  it("✓ tick satırları düşürülür", () => {
    const r = testFilter("✓ my test passed\nother line")
    expect(r).not.toContain("✓ my test")
  })

  it("FAIL satırı korunur", () => {
    const r = testFilter("FAIL src/foo.test.ts")
    expect(r).toContain("FAIL src/foo")
  })

  it("FAIL bloğu altındaki girintili satırlar korunur", () => {
    const input = "FAIL foo.test.ts\n  Expected: 1\n  Received: 2\nPASS bar.test.ts"
    const r = testFilter(input)
    expect(r).toContain("Expected: 1")
    expect(r).toContain("Received: 2")
  })

  it("summary satırları korunur", () => {
    const r = testFilter("Tests: 5 passed, 1 failed")
    expect(r).toContain("Tests: 5 passed")
  })
})

// ─── gitFilter ────────────────────────────────────────────────────────────────

describe("gitFilter", () => {
  it("git hint satırları (use 'git restore') düşürülür", () => {
    const r = gitFilter("Changes not staged:\n  (use \"git restore ...\")\n  modified: foo.ts")
    expect(r).not.toContain("use \"git restore")
    expect(r).toContain("modified: foo.ts")
  })

  it("üst üste boş satırlar daraltılır", () => {
    const r = gitFilter("a\n\n\n\nb")
    expect(r).not.toContain("\n\n\n")
  })

  it("kısa diff blok değişmeden geçer", () => {
    const lines = Array.from({ length: 5 }, (_, i) => (i === 0 ? "diff --git a/f b/f" : `+line${i}`))
    const r = gitFilter(lines.join("\n"))
    expect(r).toContain("diff --git a/f b/f")
  })

  it("büyük diff bloğu kısaltılır ve '... more diff lines' eklenir", () => {
    const header = "diff --git a/big.ts b/big.ts"
    const diffLines = Array.from({ length: 50 }, (_, i) => `+line${i}`)
    const r = gitFilter([header, ...diffLines].join("\n"))
    expect(r).toContain("more diff lines")
  })
})

// ─── lintFilter ───────────────────────────────────────────────────────────────

describe("lintFilter", () => {
  it("dosya başlık satırı korunur", () => {
    const r = lintFilter("src/foo.ts\n  1:1  error  rule/name")
    expect(r).toContain("src/foo.ts")
  })

  it("satır:sütun diagnostic korunur", () => {
    const r = lintFilter("  10:5  error  no-undef")
    expect(r).toContain("10:5")
  })

  it("problem/error özeti korunur", () => {
    const r = lintFilter("3 problems (2 errors, 1 warning)")
    expect(r).toContain("problems")
  })

  it("üst üste boş satırlar daraltılır", () => {
    const r = lintFilter("a\n\n\n\nb")
    expect(r).not.toContain("\n\n\n")
  })
})

// ─── buildFilter ─────────────────────────────────────────────────────────────

describe("buildFilter", () => {
  it("hata satırı korunur", () => {
    const r = buildFilter("error TS2345: Argument of type")
    expect(r).toContain("error TS2345")
  })

  it("TypeScript diagnostic korunur", () => {
    const r = buildFilter("src/foo.ts(10,5): error TS1234: msg")
    expect(r).toContain("error TS1234")
  })

  it("progress satırı (Compiling) düşürülür", () => {
    const r = buildFilter("  Compiling my-crate v1.0.0\nsrc/main.rs: error")
    expect(r).not.toContain("Compiling my-crate")
    expect(r).toContain("error")
  })

  it("[n/m] progress satırı düşürülür", () => {
    const r = buildFilter("[1/5] Building\nerror: something")
    expect(r).not.toContain("[1/5]")
  })

  it("üst üste boş satırlar daraltılır", () => {
    const r = buildFilter("error: x\n\n\n\nwarning: y")
    expect(r).not.toContain("\n\n\n")
  })
})

// ─── grepFilter ───────────────────────────────────────────────────────────────

describe("grepFilter", () => {
  it("az eşleşme (≤5) tam çıktı verir", () => {
    const input = Array.from({ length: 3 }, (_, i) => `src/a.ts:${i + 1}:match`).join("\n")
    const r = grepFilter(input)
    expect(r).toContain("src/a.ts:1:match")
    expect(r).toContain("src/a.ts:3:match")
  })

  it("fazla eşleşme (>5) daraltılır", () => {
    const input = Array.from({ length: 10 }, (_, i) => `src/big.ts:${i + 1}:match`).join("\n")
    const r = grepFilter(input)
    expect(r).toContain("+ 5 more matches")
  })

  it("farklı dosyalar ayrı daraltılır", () => {
    const aLines = Array.from({ length: 8 }, (_, i) => `a.ts:${i + 1}:hit`).join("\n")
    const bLines = Array.from({ length: 3 }, (_, i) => `b.ts:${i + 1}:hit`).join("\n")
    const r = grepFilter(aLines + "\n" + bLines)
    expect(r).toContain("a.ts: + 3 more matches")
    expect(r).toContain("b.ts:1:hit")
  })

  it("eşleşmeyen satırlar (passthrough) korunur", () => {
    const r = grepFilter("no-match-line\nsrc/x.ts:1:found")
    expect(r).toContain("no-match-line")
  })
})

// ─── pkgFilter ────────────────────────────────────────────────────────────────

describe("pkgFilter", () => {
  it("idealTree noise düşürülür", () => {
    const r = pkgFilter("idealTree:foo\nadded 12 packages")
    expect(r).not.toContain("idealTree")
  })

  it("Downloading satırı düşürülür", () => {
    const r = pkgFilter("Downloading foo@1.0.0\nadded 1 package")
    expect(r).not.toContain("Downloading")
  })

  it("deprecated uyarısı korunur", () => {
    const r = pkgFilter("npm warn deprecated old-package@1.0.0")
    expect(r).toContain("deprecated")
  })

  it("error satırı korunur", () => {
    const r = pkgFilter("npm error code EINVAL\nsome noise")
    expect(r).toContain("npm error code")
  })
})

// ─── detect ──────────────────────────────────────────────────────────────────

describe("detect", () => {
  it("git → 'git'", () => {
    expect(detect("git status")).toBe("git")
    expect(detect("git diff HEAD")).toBe("git")
  })

  it("vitest → 'test'", () => {
    expect(detect("vitest run")).toBe("test")
  })

  it("jest → 'test'", () => {
    expect(detect("jest --ci")).toBe("test")
  })

  it("cargo test → 'test'", () => {
    expect(detect("cargo test")).toBe("test")
  })

  it("tsc → 'build'", () => {
    expect(detect("tsc --noEmit")).toBe("build")
  })

  it("next build → 'build'", () => {
    expect(detect("next build")).toBe("build")
  })

  it("cargo build → 'build'", () => {
    expect(detect("cargo build --release")).toBe("build")
  })

  it("eslint → 'lint'", () => {
    expect(detect("eslint src/")).toBe("lint")
  })

  it("biome → 'lint'", () => {
    expect(detect("biome check")).toBe("lint")
  })

  it("grep → 'grep'", () => {
    expect(detect("grep -r foo src/")).toBe("grep")
  })

  it("rg → 'grep'", () => {
    expect(detect("rg pattern .")).toBe("grep")
  })

  it("npm install → 'pkg'", () => {
    expect(detect("npm install")).toBe("pkg")
  })

  it("pnpm install → 'pkg'", () => {
    expect(detect("pnpm install")).toBe("pkg")
  })

  it("rtk prefix sıyrılır", () => {
    expect(detect("rtk git status")).toBe("git")
    expect(detect("rtk vitest run")).toBe("test")
  })

  it("bilinmeyen komut → 'generic'", () => {
    expect(detect("python script.py")).toBe("generic")
  })

  it("boş string → 'generic'", () => {
    expect(detect("")).toBe("generic")
  })

  it("&& zinciri — ilk segment kullanılır", () => {
    expect(detect("git add . && git commit")).toBe("git")
  })
})
