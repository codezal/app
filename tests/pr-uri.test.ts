import { describe, it, expect } from "vitest"
import { isPrUri, makePrDoc, parsePrUri, getPrConversation, type PrConversation } from "@/lib/pr-uri"

const mk = (number: number): PrConversation => ({
  number,
  title: `Fix: thing #${number}`,
  htmlUrl: `https://github.com/o/r/pull/${number}`,
  author: "octocat",
  body: "body",
  comments: [],
})

describe("isPrUri", () => {
  it("matches only the pr prefix", () => {
    expect(isPrUri("codezal-pr:p1:PR%20%231")).toBe(true)
    expect(isPrUri("codezal-output:o1:x")).toBe(false)
    expect(isPrUri("/some/path.ts")).toBe(false)
  })
})

describe("makePrDoc / parsePrUri", () => {
  it("round-trips id + title", () => {
    const uri = makePrDoc(mk(685))
    expect(isPrUri(uri)).toBe(true)
    const parsed = parsePrUri(uri)
    expect(parsed).not.toBeNull()
    expect(parsed!.title).toBe("PR #685")
  })

  it("stores and retrieves the conversation payload", () => {
    const conv = mk(42)
    const uri = makePrDoc(conv)
    const { id } = parsePrUri(uri)!
    expect(getPrConversation(id)).toEqual(conv)
  })

  it("non-pr / malformed uri → null", () => {
    expect(parsePrUri("codezal-output:o1:x")).toBeNull()
    expect(parsePrUri("codezal-pr:")).toBeNull()
  })

  it("missing id → undefined", () => {
    expect(getPrConversation("nope")).toBeUndefined()
  })
})
