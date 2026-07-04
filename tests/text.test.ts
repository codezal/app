import { describe, it, expect } from "vitest"
import { sliceCharsSafe } from "@/lib/text"

// Lone surrogate guard — a high surrogate is U+D800–U+DBFF, a low one U+DC00–U+DFFF.
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true // high without following low
      i++ // valid pair → skip the low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true // low surrogate with no preceding high
    }
  }
  return false
}

describe("sliceCharsSafe", () => {
  it("returns the string unchanged when within the limit", () => {
    expect(sliceCharsSafe("abc", 5)).toBe("abc")
    expect(sliceCharsSafe("abc", 3)).toBe("abc")
  })

  it("truncates plain ASCII at the exact code-unit count", () => {
    expect(sliceCharsSafe("abcdef", 3)).toBe("abc")
  })

  it("does not split a surrogate pair when the cut lands mid-emoji", () => {
    // "ab😀cd" — 😀 (U+1F600) occupies indices 2 and 3 (two UTF-16 code units).
    // Cutting at 3 would split the pair; the high half must be dropped instead.
    const out = sliceCharsSafe("ab😀cd", 3)
    expect(out).toBe("ab")
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it("keeps the full emoji when the cut lands just after it", () => {
    const out = sliceCharsSafe("ab😀cd", 4)
    expect(out).toBe("ab😀")
    expect(hasLoneSurrogate(out)).toBe(false)
  })

  it("never emits a lone surrogate across every cut offset of an emoji-heavy string", () => {
    const s = "x😀y🎉z🚀w" // alternating ASCII + astral chars
    for (let n = 0; n <= s.length; n++) {
      expect(hasLoneSurrogate(sliceCharsSafe(s, n))).toBe(false)
    }
  })
})
