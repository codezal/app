import { describe, it, expect } from "vitest"
import { detectUrls, stripAnsi } from "@/lib/detect-urls"

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\x1b[32mhttp://localhost:5173\x1b[0m")).toBe("http://localhost:5173")
  })
})

describe("detectUrls", () => {
  it("detects a plain Vite Local banner", () => {
    const urls = detectUrls("  ➜  Local:   http://localhost:5173/")
    expect(urls.map((u) => u.url)).toEqual(["http://localhost:5173"])
    expect(urls[0].port).toBe(5173)
  })

  it("strips ANSI color codes before matching", () => {
    const urls = detectUrls("\x1b[36m  Local: \x1b[1mhttp://localhost:3000/\x1b[0m")
    expect(urls.map((u) => u.url)).toEqual(["http://localhost:3000"])
  })

  it("rewrites 0.0.0.0 to localhost", () => {
    const urls = detectUrls("listening on http://0.0.0.0:8080")
    expect(urls.map((u) => u.url)).toEqual(["http://localhost:8080"])
    expect(urls[0].port).toBe(8080)
  })

  it("detects 127.0.0.1 with a path", () => {
    const urls = detectUrls("ready at http://127.0.0.1:4321/app")
    expect(urls.map((u) => u.url)).toEqual(["http://127.0.0.1:4321/app"])
  })

  it("dedupes within a chunk and drops trailing slash", () => {
    const urls = detectUrls("http://localhost:5173/ and again http://localhost:5173")
    expect(urls.map((u) => u.url)).toEqual(["http://localhost:5173"])
  })

  it("strips trailing punctuation from log lines", () => {
    const urls = detectUrls("open (http://localhost:5173).")
    expect(urls.map((u) => u.url)).toEqual(["http://localhost:5173"])
  })

  it("detects multiple distinct servers", () => {
    const text = "Local: http://localhost:5173/\nNetwork: http://127.0.0.1:5174/"
    expect(detectUrls(text).map((u) => u.url)).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5174",
    ])
  })

  it("infers default ports when omitted", () => {
    expect(detectUrls("http://localhost/")[0].port).toBe(80)
    expect(detectUrls("https://localhost/")[0].port).toBe(443)
  })

  it("ignores non-loopback hosts", () => {
    expect(detectUrls("http://example.com:5173/")).toEqual([])
  })

  it("returns empty for text with no URLs", () => {
    expect(detectUrls("building... done in 312ms")).toEqual([])
  })
})
