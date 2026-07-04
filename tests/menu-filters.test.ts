import { describe, it, expect } from "vitest"
import { fuzzyScore, filterCommands } from "@/lib/menu-filters"
import type { SlashCommand } from "@/lib/commands"

function cmd(name: string, description = ""): SlashCommand {
  return { name, description } as SlashCommand
}

describe("fuzzyScore", () => {
  it("alt-dizi eşleşmesi skor döner, eşleşmeyen null", () => {
    expect(fuzzyScore("gitignore", "giti")).not.toBeNull()
    expect(fuzzyScore("gitignore", "gie")).not.toBeNull() // scattered subsequence
    expect(fuzzyScore("commit", "xyz")).toBeNull()
    expect(fuzzyScore("abc", "abcd")).toBeNull() // fazla harf
  })

  it("boş query → 0", () => {
    expect(fuzzyScore("anything", "")).toBe(0)
  })

  it("substring (ardışık) scattered'dan yüksek skorlu", () => {
    const contiguous = fuzzyScore("gitignore", "git")!
    const scattered = fuzzyScore("aXbXcXgit", "abc")!
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it("kelime-başı eşleşmesi bonus alır", () => {
    const wordStart = fuzzyScore("git-status", "status")!
    const mid = fuzzyScore("gitstatusx", "tatus")!
    expect(wordStart).toBeGreaterThan(mid)
  })
})

describe("filterCommands (fuzzy)", () => {
  const cmds = [cmd("git-status"), cmd("gitignore"), cmd("commit"), cmd("review", "git diff review")]

  it("boş query → hepsi", () => {
    expect(filterCommands(cmds, "")).toHaveLength(4)
  })

  it("substring eşleşen komutları döner", () => {
    const r = filterCommands(cmds, "git").map((c) => c.name)
    expect(r).toContain("git-status")
    expect(r).toContain("gitignore")
    expect(r).not.toContain("commit")
  })

  it("fuzzy (harf-atlama) eşleşir — substring değil", () => {
    const r = filterCommands(cmds, "gnore").map((c) => c.name)
    expect(r).toContain("gitignore")
  })

  it("name eşleşmesi description eşleşmesinden üstte sıralanır", () => {
    const r = filterCommands(cmds, "git").map((c) => c.name)
    expect(r.indexOf("review")).toBeGreaterThan(r.indexOf("git-status"))
    expect(r.indexOf("review")).toBeGreaterThan(r.indexOf("gitignore"))
  })

  it("eşleşmeyen query → boş", () => {
    expect(filterCommands(cmds, "zzzz")).toEqual([])
  })
})
