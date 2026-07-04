import { describe, it, expect } from "vitest"
import { parseSuggestions } from "@/lib/suggestions"

describe("parseSuggestions", () => {
  it("parses a clean JSON array and assigns ids", () => {
    const raw = JSON.stringify([
      {
        title: "Commit staged work",
        rationale: "3 files staged",
        prompt: "Commit the staged changes",
        files: ["a.ts"],
      },
    ])
    const out = parseSuggestions(raw)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: "sug-0",
      title: "Commit staged work",
      prompt: "Commit the staged changes",
      files: ["a.ts"],
    })
  })

  it("strips ```json code fences", () => {
    const raw = '```json\n[{"title":"X","prompt":"do x"}]\n```'
    expect(parseSuggestions(raw)).toHaveLength(1)
  })

  it("extracts the array from surrounding prose", () => {
    const raw = 'Here are ideas:\n[{"title":"X","prompt":"do x"}]\nHope this helps.'
    expect(parseSuggestions(raw)).toHaveLength(1)
  })

  it("drops rows missing title or prompt", () => {
    const raw = JSON.stringify([
      { title: "", prompt: "p" },
      { title: "t", prompt: "" },
      { rationale: "no title/prompt" },
      { title: "ok", prompt: "go" },
    ])
    const out = parseSuggestions(raw)
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe("ok")
  })

  it("caps at 4 items and renumbers ids sequentially", () => {
    const raw = JSON.stringify(
      Array.from({ length: 7 }, (_, i) => ({ title: `t${i}`, prompt: `p${i}` })),
    )
    const out = parseSuggestions(raw)
    expect(out).toHaveLength(4)
    expect(out.map((s) => s.id)).toEqual(["sug-0", "sug-1", "sug-2", "sug-3"])
  })

  it("filters non-string files and caps at 4", () => {
    const raw = JSON.stringify([
      { title: "t", prompt: "p", files: ["a", 1, null, "b", "c", "d", "e"] },
    ])
    const out = parseSuggestions(raw)
    expect(out[0]!.files).toEqual(["a", "b", "c", "d"])
  })

  it("returns [] for garbage, non-array, or empty input", () => {
    expect(parseSuggestions("not json")).toEqual([])
    expect(parseSuggestions("{}")).toEqual([])
    expect(parseSuggestions("")).toEqual([])
    expect(parseSuggestions('{"title":"x"}')).toEqual([])
  })
})
