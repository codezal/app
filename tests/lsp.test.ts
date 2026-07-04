import { describe, it, expect } from "vitest"
import { languageForPath } from "@/lib/lsp/language"
import { extensionOf, serverForPath, SERVERS, archiveFormat } from "@/lib/lsp/servers"

describe("languageForPath", () => {
  it("plain extension → language id", () => {
    expect(languageForPath("foo.ts")).toBe("typescript")
    expect(languageForPath("foo.tsx")).toBe("typescriptreact")
    expect(languageForPath("foo.rs")).toBe("rust")
  })

  it("path prefix ignored, case-insensitive", () => {
    expect(languageForPath("/a/b/Foo.TS")).toBe("typescript")
  })

  it("compound extension wins over plain", () => {
    // .html.erb → erb, not html
    expect(languageForPath("view.html.erb")).toBe("erb")
  })

  it("extensionless known file by basename", () => {
    expect(languageForPath("/repo/makefile")).toBe("makefile")
    expect(languageForPath("Makefile")).toBe("makefile")
  })

  it("unknown extension → undefined", () => {
    expect(languageForPath("foo.unknownext")).toBeUndefined()
    expect(languageForPath("noext")).toBeUndefined()
  })
})

describe("extensionOf", () => {
  it("returns lowercased extension without dot", () => {
    expect(extensionOf("foo.ts")).toBe("ts")
    expect(extensionOf("/a/b/Foo.TSX")).toBe("tsx")
    expect(extensionOf("a.b.c")).toBe("c")
  })

  it("no extension → empty string", () => {
    expect(extensionOf("Makefile")).toBe("")
    expect(extensionOf("/a/b/noext")).toBe("")
  })
})

describe("serverForPath", () => {
  it("matches the registered server for an extension", () => {
    expect(serverForPath("a.ts")?.id).toBe("typescript")
    expect(serverForPath("a.jsx")?.id).toBe("typescript")
    expect(serverForPath("a.py")?.id).toBe("pyright")
    expect(serverForPath("a.rs")?.id).toBe("rust")
    expect(serverForPath("a.go")?.id).toBe("gopls")
  })

  it("matches extended languages", () => {
    expect(serverForPath("a.php")?.id).toBe("php")
    expect(serverForPath("a.cpp")?.id).toBe("clangd")
    expect(serverForPath("a.java")?.id).toBe("java")
    expect(serverForPath("a.cs")?.id).toBe("csharp")
    expect(serverForPath("a.lua")?.id).toBe("lua")
    expect(serverForPath("style.scss")?.id).toBe("css")
  })

  it("each extension maps to exactly one server (no overlap)", () => {
    const seen = new Set<string>()
    for (const s of SERVERS) {
      for (const ext of s.extensions) {
        expect(seen.has(ext)).toBe(false)
        seen.add(ext)
      }
    }
  })

  it("unknown / extensionless → undefined", () => {
    expect(serverForPath("a.txt")).toBeUndefined()
    expect(serverForPath("README")).toBeUndefined()
  })
})

describe("archiveFormat", () => {
  it("uzantıdan format çıkarır", () => {
    expect(archiveFormat("x.tar.xz")).toBe("tar.xz")
    expect(archiveFormat("x.tar.gz")).toBe("tar.gz")
    expect(archiveFormat("x.zip")).toBe("zip")
    expect(archiveFormat("x.gz")).toBe("gzip")
    expect(archiveFormat("x")).toBe("raw")
  })
})

describe("rust-analyzer pickAsset", () => {
  const dl = SERVERS.find((s) => s.id === "rust")!.download!
  const names = [
    "rust-analyzer-aarch64-apple-darwin.gz",
    "rust-analyzer-x86_64-unknown-linux-gnu.gz",
    "rust-analyzer-x86_64-pc-windows-msvc.zip",
  ]
  it("macos arm64", () => {
    expect(dl.pickAsset(names, "macos", "aarch64")).toBe("rust-analyzer-aarch64-apple-darwin.gz")
  })
  it("linux x64", () => {
    expect(dl.pickAsset(names, "linux", "x86_64")).toBe("rust-analyzer-x86_64-unknown-linux-gnu.gz")
  })
  it("desteklenmeyen os → null", () => {
    expect(dl.pickAsset(names, "freebsd", "x86_64")).toBeNull()
  })
})

describe("clangd pickAsset (version-in-name + gürültü)", () => {
  const dl = SERVERS.find((s) => s.id === "clangd")!.download!
  const names = [
    "clangd-mac-22.1.0.zip",
    "clangd-linux-22.1.0.zip",
    "clangd_indexing_tools-mac-22.1.0.zip",
    "clangd-debug-symbols-windows-22.1.0.7z",
  ]
  it("mac → versiyonlu clangd zip (indexing_tools değil)", () => {
    expect(dl.pickAsset(names, "macos", "aarch64")).toBe("clangd-mac-22.1.0.zip")
  })
  it("binInArchive versiyonlu dizin yolu verir", () => {
    expect(dl.binInArchive!("clangd-mac-22.1.0.zip", "macos")).toBe("clangd_22.1.0/bin/clangd")
  })
})

describe("zls pickAsset (.minisig atla)", () => {
  const dl = SERVERS.find((s) => s.id === "zig")!.download!
  const names = [
    "zls-aarch64-macos.tar.xz",
    "zls-aarch64-macos.tar.xz.minisig",
    "zls-x86_64-windows.zip",
  ]
  it("macos arm64 → tar.xz (minisig değil)", () => {
    expect(dl.pickAsset(names, "macos", "aarch64")).toBe("zls-aarch64-macos.tar.xz")
  })
  it("windows x64 → zip", () => {
    expect(dl.pickAsset(names, "windows", "x86_64")).toBe("zls-x86_64-windows.zip")
  })
})

describe("bundled grup", () => {
  it("typescript/pyright/php bundled, download değil", () => {
    for (const id of ["typescript", "pyright", "php"]) {
      const s = SERVERS.find((x) => x.id === id)!
      expect(s.bundled).toBeTruthy()
      expect(s.download).toBeUndefined()
    }
  })
  it("rust/clangd/zig download, bundled değil", () => {
    for (const id of ["rust", "clangd", "zig"]) {
      const s = SERVERS.find((x) => x.id === id)!
      expect(s.download).toBeTruthy()
      expect(s.bundled).toBeUndefined()
    }
  })
})
