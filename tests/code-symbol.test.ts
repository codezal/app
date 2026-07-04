import { describe, it, expect } from "vitest"
import { formatSymbol, type CodeSymbol } from "@/lib/token-savers/code-symbol"

describe("formatSymbol", () => {
  it("imza varsa içerir", () => {
    const s: CodeSymbol = {
      id: "src/api.ts::fetchUser::10",
      name: "fetchUser",
      kind: "function",
      file: "src/api.ts",
      line: 10,
      sig: "(id: string) => User",
    }
    const f = formatSymbol(s)
    expect(f).toContain("src/api.ts:10")
    expect(f).toContain("fetchUser")
    expect(f).toContain("(id: string) => User")
  })

  it("imza yoksa — yok", () => {
    const s: CodeSymbol = {
      id: "src/ui.tsx::renderUser::5",
      name: "renderUser",
      kind: "function",
      file: "src/ui.tsx",
      line: 5,
    }
    const f = formatSymbol(s)
    expect(f).not.toContain("—")
  })
})
