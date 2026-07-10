import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { invoke } from "@tauri-apps/api/core"

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  vi.resetModules()
  mockInvoke.mockReset()
})

describe("shellInvocation", () => {
  it("Windows'ta Bash yoksa geçersiz cmd fallback yerine net hata verir", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "os_platform") return "windows"
      if (command === "resolve_program") return null
      return ""
    })
    const { shellInvocation } = await import("@/lib/exec")

    await expect(shellInvocation()).rejects.toThrow(/Bash.*Windows/i)
  })

  it("Windows'ta Bash varsa bash -lc kullanır", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "os_platform") return "windows"
      if (command === "resolve_program") return "C:\\Program Files\\Git\\usr\\bin\\bash.exe"
      return ""
    })
    const { shellInvocation } = await import("@/lib/exec")

    await expect(shellInvocation()).resolves.toEqual({ program: "bash", flag: "-lc" })
  })
})
