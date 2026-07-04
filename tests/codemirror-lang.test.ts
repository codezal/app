import { describe, it, expect } from "vitest"
import { langExtension, isMarkdownPath } from "@/lib/codemirror/lang"

describe("langExtension", () => {
  it("bilinen uzantı → boş olmayan extension", () => {
    expect(langExtension("/a/b.ts")).not.toEqual([])
    expect(langExtension("/a/b.tsx")).not.toEqual([])
    expect(langExtension("/a/b.css")).not.toEqual([])
    expect(langExtension("/a/b.py")).not.toEqual([])
    expect(langExtension("/a/b.rs")).not.toEqual([])
  })

  it("legacy stream dilleri (sh/toml) → boş olmayan extension", () => {
    expect(langExtension("/a/run.sh")).not.toEqual([])
    expect(langExtension("/a/Cargo.toml")).not.toEqual([])
  })

  it("uzantısız Dockerfile adı → boş olmayan extension", () => {
    expect(langExtension("/proj/Dockerfile")).not.toEqual([])
  })

  it("bilinmeyen uzantı → [] (düz metin)", () => {
    expect(langExtension("/a/b.unknownext")).toEqual([])
    expect(langExtension("/a/noext")).toEqual([])
  })
})

describe("isMarkdownPath", () => {
  it("md / mdx → true (büyük/küçük harf duyarsız)", () => {
    expect(isMarkdownPath("/a/README.md")).toBe(true)
    expect(isMarkdownPath("/a/doc.MDX")).toBe(true)
  })
  it("diğer → false", () => {
    expect(isMarkdownPath("/a/b.ts")).toBe(false)
    expect(isMarkdownPath("/a/b.txt")).toBe(false)
  })
})
