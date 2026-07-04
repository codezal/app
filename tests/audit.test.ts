import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
}))
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/home/user"),
}))

import { exists, mkdir, readTextFile, writeTextFile, rename, stat } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { appendAudit, readAudit, clearAudit } from "@/lib/plugins/audit"
import type { AuditEntry } from "@/lib/plugins/audit"

const mockExists = vi.mocked(exists)
const mockMkdir = vi.mocked(mkdir)
const mockRead = vi.mocked(readTextFile)
const mockWrite = vi.mocked(writeTextFile)
const mockRename = vi.mocked(rename)
const mockStat = vi.mocked(stat)
const mockHomeDir = vi.mocked(homeDir)

const ENTRY: AuditEntry = {
  ts: 1000,
  event: "install",
  plugin: "my-plugin@community",
  sha: "abc123",
  permissions: ["shell.exec"],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockHomeDir.mockResolvedValue("/home/user")
  mockExists.mockResolvedValue(true)
  mockMkdir.mockResolvedValue(undefined)
  mockWrite.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
  mockStat.mockResolvedValue({ size: 0 } as Awaited<ReturnType<typeof stat>>)
})

// ─── appendAudit ──────────────────────────────────────────────────────────────

describe("appendAudit", () => {
  it("geçerli JSON satırı yazar", async () => {
    await appendAudit(ENTRY)
    expect(mockWrite).toHaveBeenCalledOnce()
    const written = mockWrite.mock.calls[0]?.[1] as string
    const parsed = JSON.parse(written.trim())
    expect(parsed.event).toBe("install")
    expect(parsed.plugin).toBe("my-plugin@community")
  })

  it("satır \\n ile biter", async () => {
    await appendAudit(ENTRY)
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written.endsWith("\n")).toBe(true)
  })

  it("append: true ile yazılır", async () => {
    await appendAudit(ENTRY)
    const opts = mockWrite.mock.calls[0]?.[2] as { append?: boolean }
    expect(opts?.append).toBe(true)
  })

  it("dosya 1MB üzerindeyse rotate edilir", async () => {
    mockStat.mockResolvedValue({ size: 1_100_000 } as Awaited<ReturnType<typeof stat>>)
    await appendAudit(ENTRY)
    expect(mockRename).toHaveBeenCalledOnce()
  })

  it("dosya 1MB altındaysa rotate edilmez", async () => {
    mockStat.mockResolvedValue({ size: 500_000 } as Awaited<ReturnType<typeof stat>>)
    await appendAudit(ENTRY)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it("yazma hatası caller'a fırlatılmaz (best-effort)", async () => {
    mockWrite.mockRejectedValue(new Error("disk full"))
    await expect(appendAudit(ENTRY)).resolves.toBeUndefined()
  })
})

// ─── readAudit ────────────────────────────────────────────────────────────────

describe("readAudit", () => {
  it("log yoksa boş dizi döner", async () => {
    mockExists.mockResolvedValue(false)
    const r = await readAudit()
    expect(r).toEqual([])
  })

  it("geçerli JSON satırları parse edilir", async () => {
    const lines = [
      JSON.stringify({ ts: 1, event: "install", plugin: "a" }),
      JSON.stringify({ ts: 2, event: "uninstall", plugin: "b" }),
    ].join("\n") + "\n"
    mockRead.mockResolvedValue(lines)

    const r = await readAudit()
    expect(r).toHaveLength(2)
  })

  it("bozuk son satır atlanır", async () => {
    const lines = JSON.stringify({ ts: 1, event: "install" }) + "\n{bad json"
    mockRead.mockResolvedValue(lines)
    const r = await readAudit()
    expect(r).toHaveLength(1)
  })

  it("sonuç yeni→eskiye sıralanır (reverse)", async () => {
    const lines = [
      JSON.stringify({ ts: 1, event: "install" }),
      JSON.stringify({ ts: 2, event: "enable" }),
      JSON.stringify({ ts: 3, event: "disable" }),
    ].join("\n") + "\n"
    mockRead.mockResolvedValue(lines)

    const r = await readAudit()
    expect(r[0].ts).toBe(3)
    expect(r[2].ts).toBe(1)
  })

  it("limit parametresi dikkate alınır", async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ ts: i, event: "install" as const }),
    ).join("\n") + "\n"
    mockRead.mockResolvedValue(lines)

    const r = await readAudit(3)
    expect(r).toHaveLength(3)
  })

  it("okuma hatası → boş dizi (best-effort)", async () => {
    mockRead.mockRejectedValue(new Error("permission denied"))
    const r = await readAudit()
    expect(r).toEqual([])
  })
})

// ─── clearAudit ───────────────────────────────────────────────────────────────

describe("clearAudit", () => {
  it("audit.log varsa boşaltılır", async () => {
    mockExists.mockResolvedValue(true)
    await clearAudit()
    const calls = mockWrite.mock.calls.map((c) => c[1] as string)
    expect(calls.some((c) => c === "")).toBe(true)
  })

  it("log yoksa write çağrılmaz", async () => {
    mockExists.mockResolvedValue(false)
    await clearAudit()
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
