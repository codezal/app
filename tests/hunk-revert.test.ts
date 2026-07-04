import { describe, it, expect } from "vitest"
import { lineDiff } from "@/lib/diff"
import { countHunks, revertHunk, splitHunks } from "@/lib/hunk-revert"

describe("hunk-revert", () => {
  const base = "a\nb\nc\nd"
  const current = "a\nX\nc\nY"
  const lines = lineDiff(base, current)

  it("counts hunks separated by context lines", () => {
    expect(countHunks(lines)).toBe(2)
  })

  it("reverting hunk 0 restores its base lines, keeps other hunks", () => {
    // b→X reverted, d→Y kept → a, b, c, Y
    expect(revertHunk(lines, 0)).toBe("a\nb\nc\nY")
  })

  it("reverting hunk 1 keeps hunk 0, restores hunk 1", () => {
    expect(revertHunk(lines, 1)).toBe("a\nX\nc\nd")
  })

  it("reverting every hunk reconstructs the base", () => {
    expect(revertHunk(lineDiff(base, "a\nb\nc\nY"), 0)).toBe(base)
  })

  it("out-of-range index leaves current unchanged", () => {
    expect(revertHunk(lines, 99)).toBe(current)
  })

  it("pure addition hunk: reverting removes the added lines", () => {
    const l = lineDiff("a\nc", "a\nb\nc")
    expect(countHunks(l)).toBe(1)
    expect(revertHunk(l, 0)).toBe("a\nc")
  })

  it("pure deletion hunk: reverting restores the removed lines", () => {
    const l = lineDiff("a\nb\nc", "a\nc")
    expect(revertHunk(l, 0)).toBe("a\nb\nc")
  })

  it("preserves a trailing newline when reverting a hunk", () => {
    // base + current ikisi de '\n' ile bitiyor → revert base'in son halini korur.
    const l = lineDiff("a\nb\n", "a\nX\n")
    expect(revertHunk(l, 0)).toBe("a\nb\n")
  })

  it("EOF-newline-only change reverts cleanly (no trailing line added)", () => {
    const l = lineDiff("a\nb", "a\nb\n")
    expect(revertHunk(l, 0)).toBe("a\nb")
  })

  it("splitHunks yields one entry per changed run with sequential indices", () => {
    const hunks = splitHunks(lines)
    expect(hunks.map((h) => h.index)).toEqual([0, 1])
    expect(hunks[0].display.some((l) => l.kind === "add" && l.text === "X")).toBe(true)
    expect(hunks[1].display.some((l) => l.kind === "add" && l.text === "Y")).toBe(true)
  })
})
