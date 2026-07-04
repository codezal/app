import { describe, it, expect, vi } from "vitest"

// patch.ts top-level'da plugin-fs import eder — node test'te mock'la (fs'e dokunma).
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
}))

import { aggregateTurnEdits, turnEditsToUnifiedDiff } from "@/lib/turn-edits"
import type { Part } from "@/store/types"

const call = (toolCallId: string, toolName: string, input: unknown): Part => ({
  type: "tool-call",
  toolCallId,
  toolName,
  input,
})
const result = (toolCallId: string, toolName: string, isError = false): Part => ({
  type: "tool-result",
  toolCallId,
  toolName,
  output: "",
  isError,
})

describe("aggregateTurnEdits", () => {
  it("parts yoksa boş döner", () => {
    expect(aggregateTurnEdits(undefined)).toEqual({ files: [], totalAdded: 0, totalRemoved: 0 })
  })

  it("edit_file → +/- sayar, lines üretir", () => {
    const edits = aggregateTurnEdits([
      call("1", "edit_file", { path: "src/a.ts", old_string: "line1\nline2", new_string: "line1\nCHANGED" }),
    ])
    expect(edits.files).toHaveLength(1)
    expect(edits.files[0].path).toBe("src/a.ts")
    expect(edits.files[0].added).toBe(1)
    expect(edits.files[0].removed).toBe(1)
    expect(edits.files[0].lines.length).toBeGreaterThan(0)
    expect(edits.totalAdded).toBe(1)
    expect(edits.totalRemoved).toBe(1)
  })

  it("write_file yeni dosya (eski içerik yok) → tüm satırlar ekleme + newContent", () => {
    const edits = aggregateTurnEdits([call("1", "write_file", { path: "new.ts", content: "a\nb\nc" })])
    expect(edits.files).toHaveLength(1)
    expect(edits.files[0].added).toBe(3)
    expect(edits.files[0].removed).toBe(0)
    expect(edits.files[0].lines).toEqual([])
    expect(edits.files[0].newContent).toBe("a\nb\nc")
  })

  it("write_file overwrite (eski içerik var) → renkli diff sayar", () => {
    const edits = aggregateTurnEdits([call("1", "write_file", { path: "a.ts", content: "new" })], { "1": "old" })
    expect(edits.files[0].added).toBe(1)
    expect(edits.files[0].removed).toBe(1)
    expect(edits.files[0].lines.length).toBeGreaterThan(0)
  })

  it("apply_patch → çoklu dosya (Add + Update)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: new.ts",
      "+line1",
      "+line2",
      "*** Update File: a.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n")
    const edits = aggregateTurnEdits([call("1", "apply_patch", { patch })])
    expect(edits.files).toHaveLength(2)
    expect(edits.totalAdded).toBe(3) // 2 add + 1 add
    expect(edits.totalRemoved).toBe(1)
  })

  it("hatalı sonuçlanan tool-call özete girmez", () => {
    const edits = aggregateTurnEdits([
      call("1", "edit_file", { path: "a.ts", old_string: "x", new_string: "y" }),
      result("1", "edit_file", true),
    ])
    expect(edits.files).toHaveLength(0)
  })

  it("aynı dosyaya iki düzenleme birleşir", () => {
    const edits = aggregateTurnEdits([
      call("1", "edit_file", { path: "a.ts", old_string: "x", new_string: "y" }),
      call("2", "edit_file", { path: "a.ts", old_string: "p", new_string: "q" }),
    ])
    expect(edits.files).toHaveLength(1)
    expect(edits.files[0].added).toBe(2)
    expect(edits.files[0].removed).toBe(2)
  })

  it("edit dışı tool'lar (bash/read_file) yok sayılır", () => {
    const edits = aggregateTurnEdits([
      call("1", "bash", { command: "ls" }),
      call("2", "read_file", { path: "a.ts" }),
    ])
    expect(edits.files).toHaveLength(0)
  })
})

describe("turnEditsToUnifiedDiff", () => {
  it("edit_file → diff --git + hunk + +/- satırlar", () => {
    const edits = aggregateTurnEdits([
      call("1", "edit_file", { path: "src/a.ts", old_string: "line1\nline2", new_string: "line1\nCHANGED" }),
    ])
    const diff = turnEditsToUnifiedDiff(edits)
    expect(diff).toContain("diff --git a/src/a.ts b/src/a.ts")
    expect(diff).toContain("@@ -")
    expect(diff).toContain("-line2")
    expect(diff).toContain("+CHANGED")
    expect(diff).toContain(" line1")
  })

  it("write_file yeni dosya → @@ -0,0 +1 @@ + hep-ekleme", () => {
    const edits = aggregateTurnEdits([call("1", "write_file", { path: "new.ts", content: "a\nb" })])
    const diff = turnEditsToUnifiedDiff(edits)
    expect(diff).toContain("diff --git a/new.ts b/new.ts")
    expect(diff).toContain("@@ -0,0 +1 @@")
    expect(diff).toContain("+a")
    expect(diff).toContain("+b")
  })

  it("boş edit → boş metin", () => {
    expect(turnEditsToUnifiedDiff({ files: [], totalAdded: 0, totalRemoved: 0 })).toBe("")
  })
})
