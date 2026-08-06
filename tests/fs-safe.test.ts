import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { rename, remove, writeTextFile } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { writeTextFileAtomicSafe, renameSafe } from "@/lib/fs-safe"

const mockRename = vi.mocked(rename)
const mockRemove = vi.mocked(remove)
const mockWrite = vi.mocked(writeTextFile)
const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  vi.resetAllMocks()
  mockWrite.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
  mockRemove.mockResolvedValue(undefined)
})

describe("writeTextFileAtomicSafe", () => {
  it("stages a temp file then renames it over the target", async () => {
    await writeTextFileAtomicSafe("/ws/a.txt", "hello")
    expect(mockWrite).toHaveBeenCalledTimes(1)
    const tmp = mockWrite.mock.calls[0]?.[0] as string
    expect(tmp).toMatch(/^\/ws\/a\.txt\.tmp-/)
    expect(mockWrite).toHaveBeenCalledWith(tmp, "hello")
    expect(mockRename).toHaveBeenCalledWith(tmp, "/ws/a.txt")
  })

  it("falls back to a direct write when the rename fails", async () => {
    mockRename.mockRejectedValue(new Error("EBUSY"))
    await writeTextFileAtomicSafe("/ws/a.txt", "hello")
    expect(mockRemove).toHaveBeenCalledTimes(1) // temp cleanup
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenLastCalledWith("/ws/a.txt", "hello")
  })

  it("falls back to a direct write when even the temp write fails", async () => {
    mockWrite
      .mockRejectedValueOnce(new Error("disk error"))
      .mockResolvedValueOnce(undefined)
    await writeTextFileAtomicSafe("/ws/a.txt", "hello")
    expect(mockWrite).toHaveBeenLastCalledWith("/ws/a.txt", "hello")
    expect(mockRename).not.toHaveBeenCalled()
  })
})

describe("renameSafe", () => {
  it("uses the plugin rename normally", async () => {
    await renameSafe("/ws/a.tmp", "/ws/a.txt")
    expect(mockRename).toHaveBeenCalledWith("/ws/a.tmp", "/ws/a.txt")
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("falls back to the Rust fs_rename command on a scope error", async () => {
    mockRename.mockRejectedValue(new Error("path not allowed by scope"))
    await renameSafe("/ws/a.tmp", "/ws/a.txt")
    expect(mockInvoke).toHaveBeenCalledWith("fs_rename", {
      from: "/ws/a.tmp",
      to: "/ws/a.txt",
    })
  })
})
