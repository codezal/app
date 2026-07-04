import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("") }))

import { Command } from "@tauri-apps/plugin-shell"
import { remove } from "@tauri-apps/plugin-fs"
import { listWorktrees, listBranches, removeWorktree } from "@/lib/tools/worktree"

let executeFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  executeFn = vi.fn()
  vi.mocked(Command.create).mockReturnValue({ execute: executeFn } as unknown as ReturnType<typeof Command.create>)
})

function mockShell(stdout: string, code = 0) {
  executeFn.mockResolvedValue({ code, stdout, stderr: "" })
}

// ─── listWorktrees (tests parseWorktreePorcelain internally) ────────────────

describe("listWorktrees", () => {
  it("tek worktree parse edilir", async () => {
    mockShell(
      "worktree /repo\nHEAD abc1234\nbranch refs/heads/main\n\n",
    )
    const r = await listWorktrees("/repo")
    expect(r).toHaveLength(1)
    expect(r[0].path).toBe("/repo")
    expect(r[0].head).toBe("abc1234")
    expect(r[0].branch).toBe("main")
    expect(r[0].bare).toBe(false)
    expect(r[0].detached).toBe(false)
  })

  it("birden fazla worktree", async () => {
    mockShell(
      "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feat\nHEAD def\nbranch refs/heads/feature\n\n",
    )
    const r = await listWorktrees("/repo")
    expect(r).toHaveLength(2)
    expect(r[1].branch).toBe("feature")
  })

  it("bare worktree tespit edilir", async () => {
    mockShell("worktree /bare-repo\nHEAD abc\nbare\n\n")
    const r = await listWorktrees("/bare-repo")
    expect(r[0].bare).toBe(true)
  })

  it("detached HEAD tespit edilir", async () => {
    mockShell("worktree /repo\nHEAD abc\ndetached\n\n")
    const r = await listWorktrees("/repo")
    expect(r[0].detached).toBe(true)
  })

  it("locked worktree neden bilgisini alır", async () => {
    mockShell("worktree /repo\nHEAD abc\nbranch refs/heads/main\nlocked CI'da kullanılıyor\n\n")
    const r = await listWorktrees("/repo")
    expect(r[0].locked).toBe("CI'da kullanılıyor")
  })

  it("refs/heads/ prefix sıyrılır", async () => {
    mockShell("worktree /repo\nHEAD abc\nbranch refs/heads/feature/auth\n\n")
    const r = await listWorktrees("/repo")
    expect(r[0].branch).toBe("feature/auth")
  })

  it("git komutu başarısız olursa fırlatır", async () => {
    executeFn.mockResolvedValue({ code: 128, stdout: "", stderr: "not a git repo" })
    await expect(listWorktrees("/not-git")).rejects.toThrow(/başarısız/)
  })
})


describe("removeWorktree", () => {
  it("git remove reddedince ANA worktree'yi FS-level SİLMEZ (data-loss guard)", async () => {
    // 1) fsmonitor stop, 2) worktree remove (FAIL — git: is a main working tree),
    executeFn
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 128, stdout: "", stderr: "is a main working tree" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n",
        stderr: "",
      })
    await expect(removeWorktree("/repo", "/repo")).rejects.toThrow(/Ana worktree silinemez/)
    expect(vi.mocked(remove)).not.toHaveBeenCalled()
  })

  it("kayıtsız target → FS-level silmez", async () => {
    executeFn
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fsmonitor
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fatal" }) // remove fail
      .mockResolvedValueOnce({
        code: 0,
        stdout: "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n",
        stderr: "",
      }) // list — /evil yok
    await expect(removeWorktree("/repo", "/evil/path")).rejects.toThrow(/kayıtlı worktree değil/)
    expect(vi.mocked(remove)).not.toHaveBeenCalled()
  })
})

// ─── listBranches ──────────────────────────────────────────────────────────────

describe("listBranches", () => {
  it("branch listesi döner", async () => {
    mockShell("main\nfeature\nfix/bug\n")
    const r = await listBranches("/repo")
    expect(r).toContain("main")
    expect(r).toContain("feature")
    expect(r).toContain("fix/bug")
  })

  it("boş satırlar filtrelenir", async () => {
    mockShell("main\n\nfeature\n")
    const r = await listBranches("/repo")
    expect(r.every((b) => b.length > 0)).toBe(true)
  })

  it("git başarısız → boş dizi", async () => {
    executeFn.mockResolvedValue({ code: 1, stdout: "", stderr: "error" })
    const r = await listBranches("/repo")
    expect(r).toEqual([])
  })
})
