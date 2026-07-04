import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
  stat: vi.fn(),
  BaseDirectory: { AppData: 1 },
}))

import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  exists,
  stat,
} from "@tauri-apps/plugin-fs"
import { listDir, readFile, readFileAbs, writeFile, editFile } from "@/lib/tools/fs"

const mockRead = vi.mocked(readTextFile)
const mockWrite = vi.mocked(writeTextFile)
const mockReadDir = vi.mocked(readDir)
const mockMkdir = vi.mocked(mkdir)
const mockExists = vi.mocked(exists)
const mockStat = vi.mocked(stat)

const WS = "/workspace"

beforeEach(() => {
  vi.resetAllMocks()
  mockWrite.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
  mockExists.mockResolvedValue(false)
})

// ─── listDir ──────────────────────────────────────────────────────────────────

describe("listDir", () => {
  it("dosya + dizin listeler", async () => {
    mockReadDir.mockResolvedValue([
      { name: "src", isDirectory: true, isFile: false, isSymlink: false },
      { name: "README.md", isDirectory: false, isFile: true, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r).toContain("src")
    expect(r).toContain("README.md")
  })

  it("boş klasör → '(boş klasör)'", async () => {
    mockReadDir.mockResolvedValue([])
    const r = await listDir(WS, ".")
    expect(r).toBe("(boş klasör)")
  })

  it("dizinler önce listelenir", async () => {
    mockReadDir.mockResolvedValue([
      { name: "file.ts", isDirectory: false, isFile: true, isSymlink: false },
      { name: "subdir", isDirectory: true, isFile: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r.indexOf("subdir")).toBeLessThan(r.indexOf("file.ts"))
  })

  it("dosya boyutu gösterilir", async () => {
    mockReadDir.mockResolvedValue([
      { name: "big.ts", isDirectory: false, isFile: true, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockStat.mockResolvedValue({ size: 2048 } as Awaited<ReturnType<typeof stat>>)

    const r = await listDir(WS, ".")
    expect(r).toContain("big.ts")
    // 2048 bytes = 2.0K
    expect(r).toMatch(/2\.0K/)
  })

  it("dosya verilince '(boş klasör)' değil net hata döner", async () => {
    mockReadDir.mockRejectedValue(new Error("ENOTDIR"))
    mockExists.mockResolvedValue(true)
    const r = await listDir(WS, "file.ts")
    expect(r).toContain("bir dizin değil")
  })

  it("var olmayan yol → '(boş klasör)' değil 'bulunamadı'", async () => {
    mockReadDir.mockRejectedValue(new Error("ENOENT"))
    mockExists.mockResolvedValue(false)
    const r = await listDir(WS, "nope")
    expect(r).toContain("bulunamadı")
  })
})

// ─── readFile ─────────────────────────────────────────────────────────────────

describe("readFile", () => {
  it("içerik satır numaralı döner", async () => {
    mockRead.mockResolvedValue("line one\nline two\nline three")
    const r = await readFile(WS, "src/foo.ts")
    expect(r).toContain("line one")
    expect(r).toContain("line two")
    expect(r).toMatch(/^\s*1\t/m)
    expect(r).toMatch(/^\s*2\t/m)
  })

  it("offset + limit çalışır", async () => {
    mockRead.mockResolvedValue("L1\nL2\nL3\nL4\nL5")
    const r = await readFile(WS, "f.ts", 2, 2)
    expect(r).toContain("L2")
    expect(r).toContain("L3")
    expect(r).not.toContain("L1")
    expect(r).not.toContain("L5")
  })

  it("offset başlangıç satır numarasını ayarlar", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFile(WS, "f.ts", 2, 1)
    expect(r).toMatch(/^\s*2\t/m)
  })

  it("uzun satır 2000 karaktere kısaltılır", async () => {
    mockRead.mockResolvedValue("x".repeat(250_000))
    const r = await readFile(WS, "big.ts")
    expect(r).toContain("kısaltıldı")
  })

  it("footer dosya sonunu + toplam satırı belirtir", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFile(WS, "f.ts")
    expect(r).toContain("Dosya sonu")
    expect(r).toContain("3 satır")
  })

  it("2000 satırdan fazla → ilk 2000 + devam offset'i", async () => {
    mockRead.mockResolvedValue(Array.from({ length: 2500 }, (_, i) => `line${i}`).join("\n"))
    const r = await readFile(WS, "f.ts")
    expect(r).toContain("Devamı için offset=2001")
    expect(r).not.toContain("line2400")
  })

  it("offset dosya dışında → net hata", async () => {
    mockRead.mockResolvedValue("a\nb")
    const r = await readFile(WS, "f.ts", 99)
    expect(r).toContain("aralığı dışında")
  })

  it("dizin verilince list_dir'e yönlendirir (ham IO hatası değil)", async () => {
    mockStat.mockResolvedValue({ isDirectory: true } as Awaited<ReturnType<typeof stat>>)
    const r = await readFile(WS, "src")
    expect(r).toContain("bir dizin")
    expect(r).toContain("list_dir")
  })

  it("maxChars verilince tek okuma erken kesilir + devam offset'i döner", async () => {
    mockRead.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => `L${i}_` + "y".repeat(46)).join("\n"),
    )
    const r = await readFileAbs("/workspace/big.ts", undefined, undefined, 2000)
    expect(r).toContain("karakter sınırına ulaşıldı")
    expect(r).toContain("Devamı için offset=")
    expect(r).not.toContain("L99_")
  })

  it("maxChars içeriği aşıyorsa tüm dosya okunur (kesme yok)", async () => {
    mockRead.mockResolvedValue("a\nb\nc")
    const r = await readFileAbs("/workspace/f.ts", undefined, undefined, 100_000)
    expect(r).toContain("Dosya sonu")
  })
})

// ─── writeFile ────────────────────────────────────────────────────────────────

describe("writeFile", () => {
  it("içerik yazılır, başarı mesajı döner", async () => {
    const r = await writeFile(WS, "src/new.ts", "const x = 1")
    expect(mockWrite).toHaveBeenCalledWith(
      `${WS}/src/new.ts`,
      "const x = 1",
    )
    expect(r).toContain("src/new.ts")
  })

  it("parent dizin yoksa mkdir çağrılır", async () => {
    mockExists.mockResolvedValue(false)
    await writeFile(WS, "a/b/c.ts", "")
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("a/b"),
      expect.objectContaining({ recursive: true }),
    )
  })

  it("parent dizin varsa mkdir çağrılmaz", async () => {
    mockExists.mockResolvedValue(true)
    await writeFile(WS, "existing/file.ts", "x")
    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it("yeni dosya → çıktı 'oluşturuldu'", async () => {
    mockExists.mockResolvedValue(false)
    const r = await writeFile(WS, "new.ts", "x")
    expect(r).toContain("oluşturuldu")
  })

  it("mevcut dosya overwrite → çıktı 'güncellendi'", async () => {
    mockExists.mockResolvedValue(true)
    const r = await writeFile(WS, "old.ts", "x")
    expect(r).toContain("güncellendi")
  })
})

// ─── editFile ─────────────────────────────────────────────────────────────────

describe("editFile", () => {
  it("old_string → new_string ile değiştirilir", async () => {
    mockRead.mockResolvedValue("const x = 1\nconst y = 2\n")
    const r = await editFile(WS, "f.ts", "const x = 1", "const x = 99")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("const x = 99")
    expect(written).not.toContain("const x = 1")
    expect(r).toContain("f.ts")
  })

  it("old_string bulunamazsa fırlatır", async () => {
    mockRead.mockResolvedValue("something else entirely")
    await expect(editFile(WS, "f.ts", "missing text", "new")).rejects.toThrow(/bulunamadı/)
  })

  it("old_string birden fazla yerde geçerse fırlatır", async () => {
    mockRead.mockResolvedValue("dup\ndup\n")
    await expect(editFile(WS, "f.ts", "dup", "X")).rejects.toThrow(/birden fazla/)
  })

  it("replace_all tüm geçişleri değiştirir", async () => {
    mockRead.mockResolvedValue("foo foo foo\n")
    await editFile(WS, "f.ts", "foo", "bar", true)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toBe("bar bar bar\n")
  })

  it("girinti uyuşmazlığını fallback ile tolere eder", async () => {
    mockRead.mockResolvedValue("if (x) {\n    doThing()\n}\n")
    await editFile(WS, "f.ts", "if (x) {\ndoThing()\n}", "DONE")
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("DONE")
  })
})
