import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { readTextFile, writeTextFile, exists, remove } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { applyPatch, formatApplyResult, parsePatchForUI } from "@/lib/tools/patch"

const mockRead = vi.mocked(readTextFile)
const mockWrite = vi.mocked(writeTextFile)
const mockExists = vi.mocked(exists)
const mockRemove = vi.mocked(remove)
const mockInvoke = vi.mocked(invoke)

const WS = "/workspace"

beforeEach(() => {
  vi.resetAllMocks()
  mockExists.mockResolvedValue(true)
  mockWrite.mockResolvedValue(undefined)
  mockRemove.mockResolvedValue(undefined)
})

// ─── formatApplyResult ────────────────────────────────────────────────────────

describe("formatApplyResult", () => {
  it("hepsi boş → değişiklik yok mesajı", () => {
    const r = formatApplyResult({ filesChanged: [], filesAdded: [], filesDeleted: [], filesMoved: [], hunksApplied: 0 })
    expect(r).toContain("değişmedi")
  })

  it("değiştirilen dosya M ile listede görünür", () => {
    const r = formatApplyResult({ filesChanged: ["src/foo.ts"], filesAdded: [], filesDeleted: [], filesMoved: [], hunksApplied: 1 })
    expect(r).toContain("M src/foo.ts")
    expect(r).toContain("1 hunk")
  })

  it("eklenen dosya A ile listede görünür", () => {
    const r = formatApplyResult({ filesChanged: [], filesAdded: ["src/new.ts"], filesDeleted: [], filesMoved: [], hunksApplied: 1 })
    expect(r).toContain("A src/new.ts")
  })

  it("silinen dosya D ile listede görünür", () => {
    const r = formatApplyResult({ filesChanged: [], filesAdded: [], filesDeleted: ["src/old.ts"], filesMoved: [], hunksApplied: 1 })
    expect(r).toContain("D src/old.ts")
  })

  it("taşınan dosya R ile listede görünür", () => {
    const r = formatApplyResult({ filesChanged: [], filesAdded: [], filesDeleted: [], filesMoved: [{ from: "a.ts", to: "b.ts" }], hunksApplied: 1 })
    expect(r).toContain("R a.ts → b.ts")
  })

  it("çoklu dosya ayrı satırlarda", () => {
    const r = formatApplyResult({
      filesChanged: ["a.ts", "b.ts"],
      filesAdded: [],
      filesDeleted: [],
      filesMoved: [],
      hunksApplied: 2,
    })
    expect(r).toContain("M a.ts")
    expect(r).toContain("M b.ts")
  })
})

// ─── applyPatch — Update File ─────────────────────────────────────────────────

describe("applyPatch — Update File", () => {
  it("Tauri scope reddederse güvenli Rust fallback ile düzenler", async () => {
    mockExists.mockRejectedValue(new Error("path not allowed by scope"))
    mockRead.mockRejectedValue(new Error("path not allowed by scope"))
    mockWrite.mockRejectedValue(new Error("path not allowed by scope"))
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fs_exists") return true
      if (command === "fs_read_text_file") return "before\n"
      if (command === "fs_write_text_file") return undefined
      throw new Error(`unexpected invoke: ${command}`)
    })
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/foo.ts",
      "@@",
      "-before",
      "+after",
      "*** End Patch",
    ].join("\n")

    const result = await applyPatch(WS, patch)

    expect(result.filesChanged).toEqual(["src/foo.ts"])
    expect(mockInvoke).toHaveBeenCalledWith("fs_write_text_file", {
      path: "/workspace/src/foo.ts",
      contents: "after\n",
    })
  })

  it("tek hunk satır değiştirir", async () => {
    mockRead.mockResolvedValue("line1\nold line\nline3\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/foo.ts",
      "@@",
      " line1",
      "-old line",
      "+new line",
      " line3",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.filesChanged).toContain("src/foo.ts")
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("new line")
    expect(written).not.toContain("old line")
  })

  it("birden fazla hunk uygulanır", async () => {
    mockRead.mockResolvedValue("a\nb\nc\nd\ne\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      " a",
      "-b",
      "+B",
      "@@",
      " d",
      "-e",
      "+E",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(2)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("B")
    expect(written).toContain("E")
  })

  it("model bloğu trailing-whitespace ile verse de eşleştirir (fuzzy — eski indexOf PATLARDI)", async () => {
    mockRead.mockResolvedValue("keep\nchange me\ntail\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      " keep",
      "-change me   ",
      "+changed",
      " tail",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("changed")
    expect(written).not.toContain("change me")
  })

  it("akıllı tırnak (unicode) farkını normalize eder", async () => {
    mockRead.mockResolvedValue("const s = 'hi'\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      "-const s = ‘hi’",
      "+const s = 'bye'",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("bye")
  })

  it("@@ context başlığı belirsiz eşleşmeyi doğru bloğa yönlendirir", async () => {
    mockRead.mockResolvedValue("function a() {\n  return x\n}\nfunction b() {\n  return x\n}\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@ function b()",
      "-  return x",
      "+  return y",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("return y")
    expect(written.match(/return x/g)?.length).toBe(1)
  })

  it("pure-add hunk @@ context'ten SONRA ekler (EOF'a değil)", async () => {
    mockRead.mockResolvedValue("function a() {\n  body\n}\nfunction b() {\n  body\n}\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@ function a()", // context: a()'dan sonra eklenmeli
      "+  // yeni satir",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written.indexOf("// yeni satir")).toBeLessThan(written.indexOf("function b()"))
  })

  it("pure-add hunk context'siz → dosya sonuna ekler (mevcut davranış korunur)", async () => {
    mockRead.mockResolvedValue("line1\nline2\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      "+line3",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.hunksApplied).toBe(1)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written.indexOf("line3")).toBeGreaterThan(written.indexOf("line2"))
  })

  it("@@ context yokken belirsiz eşleşme yine hata verir", async () => {
    mockRead.mockResolvedValue("dup\ndup\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      "-dup",
      "+NEW",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/birden fazla/)
  })

  it("dosya yoksa hata fırlatır", async () => {
    mockExists.mockResolvedValue(false)
    const patch = [
      "*** Begin Patch",
      "*** Update File: missing.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/dosya yok/)
  })

  it("hunk eşleşmezse hata fırlatır", async () => {
    mockRead.mockResolvedValue("completely different content\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      "-line that does not exist",
      "+replacement",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/eşleşmedi/)
  })

  it("aynı blok birden fazla yerde varsa hata fırlatır", async () => {
    mockRead.mockResolvedValue("dup\ndup\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: f.ts",
      "@@",
      "-dup",
      "+NEW",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/birden fazla/)
  })
})

// ─── applyPatch — Add File ────────────────────────────────────────────────────

describe("applyPatch — Add File", () => {
  it("yeni dosya oluşturulur", async () => {
    mockExists.mockResolvedValue(false)
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const x = 1",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.filesAdded).toContain("src/new.ts")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("export const x = 1")
  })

  it("dosya zaten varsa hata fırlatır", async () => {
    mockExists.mockResolvedValue(true)
    const patch = [
      "*** Begin Patch",
      "*** Add File: existing.ts",
      "+content",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/zaten var/)
  })
})

// ─── applyPatch — Delete File ─────────────────────────────────────────────────

describe("applyPatch — Delete File", () => {
  it("dosya silinir", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Delete File: src/old.ts",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.filesDeleted).toContain("src/old.ts")
    expect(mockRemove).toHaveBeenCalledOnce()
  })

  it("dosya yoksa hata fırlatır", async () => {
    mockExists.mockResolvedValue(false)
    const patch = [
      "*** Begin Patch",
      "*** Delete File: gone.ts",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/dosya yok/)
  })
})

// ─── applyPatch — Move to (rename) ────────────────────────────────────────────

describe("applyPatch — Move to", () => {
  it("dosyayı yeni yola taşır + eskiyi siler", async () => {
    mockRead.mockResolvedValue("line1\nold\nline3\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/foo.ts",
      "*** Move to: src/bar.ts",
      "@@",
      " line1",
      "-old",
      "+new",
      " line3",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.filesMoved).toEqual([{ from: "src/foo.ts", to: "src/bar.ts" }])
    expect(r.filesChanged).not.toContain("src/foo.ts")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("new")
    expect(mockRemove).toHaveBeenCalledOnce()
  })
})

// ─── applyPatch — parse errors ────────────────────────────────────────────────

describe("applyPatch — format hataları", () => {
  it("Begin Patch eksik → hata", async () => {
    await expect(applyPatch(WS, "not a patch")).rejects.toThrow(/Begin Patch/)
  })

  it("boş patch (Begin/End arası boş) → hata", async () => {
    await expect(applyPatch(WS, "*** Begin Patch\n*** End Patch")).rejects.toThrow(/Boş patch/)
  })

  it("End Patch eksik → hata", async () => {
    await expect(applyPatch(WS, "*** Begin Patch\n*** Update File: f.ts\n@@\n-x\n+y"))
      .rejects.toThrow(/End Patch/)
  })

  it("bilinmeyen direktif → hata", async () => {
    await expect(
      applyPatch(WS, "*** Begin Patch\n*** Unknown Directive: foo\n*** End Patch"),
    ).rejects.toThrow()
  })

  it("Update File altında @@ yoksa hata", async () => {
    mockExists.mockResolvedValue(true)
    await expect(
      applyPatch(WS, "*** Begin Patch\n*** Update File: f.ts\n*** End Patch"),
    ).rejects.toThrow(/@@/)
  })
})


describe("applyPatch — çoklu dosya", () => {
  it("iki farklı dosya tek patch'te", async () => {
    mockRead
      .mockResolvedValueOnce("aaa\n")
      .mockResolvedValueOnce("bbb\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      "-aaa",
      "+AAA",
      "*** Update File: b.ts",
      "@@",
      "-bbb",
      "+BBB",
      "*** End Patch",
    ].join("\n")
    const r = await applyPatch(WS, patch)
    expect(r.filesChanged).toContain("a.ts")
    expect(r.filesChanged).toContain("b.ts")
    expect(r.hunksApplied).toBe(2)
  })
})


describe("applyPatch — atomiklik", () => {
  it("ikinci op patlarsa HİÇBİR dosya yazılmaz (faz-1 hata → faz-2 atlanır)", async () => {
    mockRead.mockResolvedValueOnce("aaa\n").mockResolvedValueOnce("bbb\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      "-aaa",
      "+AAA",
      "*** Update File: b.ts",
      "@@",
      "-NOPE",
      "+x",
      "*** End Patch",
    ].join("\n")
    await expect(applyPatch(WS, patch)).rejects.toThrow(/eşleşmedi/)
    expect(mockWrite).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})


describe("parsePatchForUI — gutter satır no", () => {
  it("update hunk: del→oldNo, add→newNo, ctx→ikisi", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      " ctx1",
      "-old1",
      "+new1",
      " ctx2",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.op).toBe("update")
    expect(view.lines).toEqual([
      { kind: "ctx", text: "ctx1", oldNo: 1, newNo: 1 },
      { kind: "del", text: "old1", oldNo: 2 },
      { kind: "add", text: "new1", newNo: 2 },
      { kind: "ctx", text: "ctx2", oldNo: 3, newNo: 3 },
    ])
  })

  it("add file: hep-add, newNo 1..N", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: new.ts",
      "+line1",
      "+line2",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.op).toBe("add")
    expect(view.lines).toEqual([
      { kind: "add", text: "line1", newNo: 1 },
      { kind: "add", text: "line2", newNo: 2 },
    ])
  })

  it("çoklu hunk arası '…' ayraç, numara sürekli akar", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      "-a",
      "+A",
      "@@",
      "-b",
      "+B",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.lines).toEqual([
      { kind: "del", text: "a", oldNo: 1 },
      { kind: "add", text: "A", newNo: 1 },
      { kind: "ctx", text: "…" },
      { kind: "del", text: "b", oldNo: 2 },
      { kind: "add", text: "B", newNo: 2 },
    ])
  })

  it("bağlam ±2'ye kırpılır — dev context duvarı gösterilmez (edit_file paritesi)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      " c1",
      " c2",
      " c3",
      " c4",
      "-old",
      "+new",
      " c5",
      " c6",
      " c7",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.lines).toEqual([
      { kind: "ctx", text: "c3", oldNo: 3, newNo: 3 },
      { kind: "ctx", text: "c4", oldNo: 4, newNo: 4 },
      { kind: "del", text: "old", oldNo: 5 },
      { kind: "add", text: "new", newNo: 5 },
      { kind: "ctx", text: "c5", oldNo: 6, newNo: 6 },
      { kind: "ctx", text: "c6", oldNo: 7, newNo: 7 },
    ])
  })

  it("move + içerik değişimi → movePath + diff satırları (DiffBlock 'a → b' başlık)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "*** Move to: b.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.movePath).toBe("b.ts")
    expect(view.lines).toEqual([
      { kind: "del", text: "old", oldNo: 1 },
      { kind: "add", text: "new", newNo: 1 },
    ])
  })

  it("içerik değişimsiz rename → movePath dolu, lines BOŞ (MovedFileLine ile gösterilir)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "*** Move to: b.ts",
      "@@",
      " unchanged",
      "*** End Patch",
    ].join("\n")
    const [view] = parsePatchForUI(patch)
    expect(view.op).toBe("update")
    expect(view.movePath).toBe("b.ts")
    expect(view.lines).toEqual([])
  })
})
