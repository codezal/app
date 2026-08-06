import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
  stat: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  BaseDirectory: { AppData: 1 },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  exists,
  stat,
  rename,
  remove,
} from "@tauri-apps/plugin-fs"
import { listDir, readFile, readFileAbs, writeFile, editFile } from "@/lib/tools/fs"

const mockRead = vi.mocked(readTextFile)
const mockWrite = vi.mocked(writeTextFile)
const mockReadDir = vi.mocked(readDir)
const mockMkdir = vi.mocked(mkdir)
const mockExists = vi.mocked(exists)
const mockStat = vi.mocked(stat)
const mockRename = vi.mocked(rename)
const mockRemove = vi.mocked(remove)

const WS = "/workspace"

beforeEach(() => {
  vi.resetAllMocks()
  mockWrite.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
  mockExists.mockResolvedValue(false)
  mockRename.mockResolvedValue(undefined)
  mockRemove.mockResolvedValue(undefined)
})

// ─── listDir ──────────────────────────────────────────────────────────────────

describe("listDir", () => {
  it("lists files + directories", async () => {
    mockReadDir.mockResolvedValue([
      { name: "src", isDirectory: true, isFile: false, isSymlink: false },
      { name: "README.md", isDirectory: false, isFile: true, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r).toContain("src")
    expect(r).toContain("README.md")
  })

  it("empty folder → '(empty folder)'", async () => {
    mockReadDir.mockResolvedValue([])
    const r = await listDir(WS, ".")
    expect(r).toBe("(empty folder)")
  })

  it("directories are listed first", async () => {
    mockReadDir.mockResolvedValue([
      { name: "file.ts", isDirectory: false, isFile: true, isSymlink: false },
      { name: "subdir", isDirectory: true, isFile: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r.indexOf("subdir")).toBeLessThan(r.indexOf("file.ts"))
  })

  it("shows file size", async () => {
    mockReadDir.mockResolvedValue([
      { name: "big.ts", isDirectory: false, isFile: true, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 2048 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r).toContain("big.ts")
    // 2048 bytes = 2.0K
    expect(r).toMatch(/2\.0K/)
  })

  it("returns a clear error (not '(empty folder)') when given a file", async () => {
    mockReadDir.mockRejectedValue(new Error("ENOTDIR"))
    mockExists.mockResolvedValue(true)
    const r = await listDir(WS, "file.ts")
    expect(r).toContain("not a directory")
  })

  it("nonexistent path → 'not found' (not '(empty folder)')", async () => {
    mockReadDir.mockRejectedValue(new Error("ENOENT"))
    mockExists.mockResolvedValue(false)
    const r = await listDir(WS, "nope")
    expect(r).toContain("not found")
  })
})

// ─── readFile ─────────────────────────────────────────────────────────────────

describe("readFile", () => {
  it("returns content with line numbers", async () => {
    mockRead.mockResolvedValue("line one\nline two\nline three")
    const r = await readFile(WS, "src/foo.ts")
    expect(r).toContain("line one")
    expect(r).toContain("line two")
    expect(r).toMatch(/^\s*1\t/m)
    expect(r).toMatch(/^\s*2\t/m)
  })

  it("offset + limit work", async () => {
    mockRead.mockResolvedValue("L1\nL2\nL3\nL4\nL5")
    const r = await readFile(WS, "f.ts", 2, 2)
    expect(r).toContain("L2")
    expect(r).toContain("L3")
    expect(r).not.toContain("L1")
    expect(r).not.toContain("L5")
  })

  it("offset sets the starting line number", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFile(WS, "f.ts", 2, 1)
    expect(r).toMatch(/^\s*2\t/m)
  })

  it("truncates a long line to 2000 characters", async () => {
    mockRead.mockResolvedValue("x".repeat(250_000))
    const r = await readFile(WS, "big.ts")
    expect(r).toContain("truncated")
  })

  it("footer states end of file + total lines", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFile(WS, "f.ts")
    expect(r).toContain("End of file")
    expect(r).toContain("3 lines")
  })

  it("more than 2000 lines → first 2000 + continuation offset", async () => {
    mockRead.mockResolvedValue(Array.from({ length: 2500 }, (_, i) => `line${i}`).join("\n"))
    const r = await readFile(WS, "f.ts")
    expect(r).toContain("Continue with offset=2001")
    expect(r).not.toContain("line2400")
  })

  it("offset beyond file → clear error", async () => {
    mockRead.mockResolvedValue("a\nb")
    const r = await readFile(WS, "f.ts", 99)
    expect(r).toContain("out of range")
  })

  it("redirects to list_dir when given a directory (not a raw IO error)", async () => {
    mockStat.mockResolvedValue({ isDirectory: true } as Awaited<ReturnType<typeof stat>>)
    const r = await readFile(WS, "src")
    expect(r).toContain("a directory")
    expect(r).toContain("list_dir")
  })

  it("with maxChars, a single read stops early + returns a continuation offset", async () => {
    mockRead.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => `L${i}_` + "y".repeat(46)).join("\n"),
    )
    const r = await readFileAbs("/workspace/big.ts", undefined, undefined, 2000)
    expect(r).toContain("character limit")
    expect(r).toContain("Continue with offset=")
    expect(r).not.toContain("L99_")
  })

  it("if maxChars exceeds the content, the whole file is read (no truncation)", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFileAbs("/workspace/f.ts", undefined, undefined, 100_000)
    expect(r).toContain("End of file")
  })

  it("CRLF content: no stray \\r leaks into the numbered output", async () => {
    mockRead.mockResolvedValue("line one\r\nline two\r\n")
    const r = await readFile(WS, "win.txt")
    expect(r).not.toContain("\r")
    expect(r).toContain("line one")
    expect(r).toContain("line two")
  })
})

// ─── writeFile ────────────────────────────────────────────────────────────────

describe("writeFile", () => {
  it("stages to a temp file then renames over the target (atomic)", async () => {
    const r = await writeFile(WS, "src/new.ts", "const x = 1")
    expect(mockWrite).toHaveBeenCalledTimes(1)
    const tmpPath = mockWrite.mock.calls[0]?.[0] as string
    expect(tmpPath).toMatch(/src\/new\.ts\.tmp-/)
    expect(mockWrite).toHaveBeenCalledWith(tmpPath, "const x = 1")
    expect(mockRename).toHaveBeenCalledWith(tmpPath, `${WS}/src/new.ts`)
    expect(r).toContain("src/new.ts")
  })

  it("falls back to a direct write when the rename fails", async () => {
    mockRename.mockRejectedValue(new Error("EBUSY: target locked"))
    const r = await writeFile(WS, "src/new.ts", "const x = 1")
    expect(mockWrite).toHaveBeenCalledTimes(2) // temp + direct fallback
    expect(mockWrite).toHaveBeenLastCalledWith(`${WS}/src/new.ts`, "const x = 1")
    expect(mockRemove).toHaveBeenCalledTimes(1) // temp cleanup attempt
    expect(r).toContain("src/new.ts")
  })

  it("calls mkdir when the parent directory is missing", async () => {
    mockExists.mockResolvedValue(false)
    await writeFile(WS, "a/b/c.ts", "")
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("a/b"),
      expect.objectContaining({ recursive: true }),
    )
  })

  it("does not call mkdir when the parent directory exists", async () => {
    mockExists.mockResolvedValue(true)
    await writeFile(WS, "existing/file.ts", "x")
    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it("new file → output 'created'", async () => {
    mockExists.mockResolvedValue(false)
    const r = await writeFile(WS, "new.ts", "x")
    expect(r).toContain("created")
  })

  it("existing file overwrite → output 'updated'", async () => {
    mockExists.mockResolvedValue(true)
    const r = await writeFile(WS, "old.ts", "x")
    expect(r).toContain("updated")
  })
})

// ─── editFile ─────────────────────────────────────────────────────────────────

describe("editFile", () => {
  it("replaces old_string with new_string", async () => {
    mockRead.mockResolvedValue("const x = 1\nconst y = 2\n")
    const r = await editFile(WS, "f.ts", "const x = 1", "const x = 99")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("const x = 99")
    expect(written).not.toContain("const x = 1")
    expect(r).toContain("f.ts")
  })

  it("throws when old_string is not found", async () => {
    mockRead.mockResolvedValue("something else entirely")
    await expect(editFile(WS, "f.ts", "missing text", "new")).rejects.toThrow(/not found/)
  })

  it("throws when old_string occurs in multiple places", async () => {
    mockRead.mockResolvedValue("dup\ndup\n")
    await expect(editFile(WS, "f.ts", "dup", "X")).rejects.toThrow(/multiple places/)
  })

  it("replace_all replaces every occurrence", async () => {
    mockRead.mockResolvedValue("foo foo foo\n")
    await editFile(WS, "f.ts", "foo", "bar", true)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toBe("bar bar bar\n")
  })

  it("tolerates indentation mismatch via fallback", async () => {
    mockRead.mockResolvedValue("if (x) {\n    doThing()\n}\n")
    await editFile(WS, "f.ts", "if (x) {\ndoThing()\n}", "DONE")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("DONE")
  })
})
