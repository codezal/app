import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("") }))

import { Command } from "@tauri-apps/plugin-shell"
import { statusLabel, gitStatus, assertSafeBranchName } from "@/lib/git"
import type { GitStatusEntry } from "@/lib/git"

let executeFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  executeFn = vi.fn()
  vi.mocked(Command.create).mockReturnValue({ execute: executeFn } as unknown as ReturnType<typeof Command.create>)
})

function mockGit(stdout: string, code = 0) {
  executeFn.mockResolvedValue({ code, stdout, stderr: "" })
}

// ─── statusLabel ─────────────────────────────────────────────────────────────

describe("statusLabel", () => {
  const e = (index: string, worktree: string, path = "f.ts", oldPath?: string): GitStatusEntry =>
    ({ index, worktree, path, oldPath })

  it("?? → untracked", () => {
    expect(statusLabel(e("?", "?"))).toMatchObject({ kind: "untracked", code: "??" })
  })

  it("!! → ignored", () => {
    expect(statusLabel(e("!", "!"))).toMatchObject({ kind: "ignored" })
  })

  it("M → modified", () => {
    expect(statusLabel(e("M", " "))).toMatchObject({ kind: "mod" })
    expect(statusLabel(e(" ", "M"))).toMatchObject({ kind: "mod" })
  })

  it("A → added", () => {
    expect(statusLabel(e("A", " "))).toMatchObject({ kind: "add" })
  })

  it("D → deleted", () => {
    expect(statusLabel(e("D", " "))).toMatchObject({ kind: "del" })
    expect(statusLabel(e(" ", "D"))).toMatchObject({ kind: "del" })
  })

  it("R (oldPath var) → renamed", () => {
    expect(statusLabel(e("R", " ", "new.ts", "old.ts"))).toMatchObject({ kind: "ren" })
  })

  it("UU → conflict", () => {
    expect(statusLabel(e("U", "U"))).toMatchObject({ kind: "conflict" })
  })

  it("AA → conflict", () => {
    expect(statusLabel(e("A", "A"))).toMatchObject({ kind: "conflict" })
  })

  it("DD → conflict", () => {
    expect(statusLabel(e("D", "D"))).toMatchObject({ kind: "conflict" })
  })
})

// ─── gitStatus ────────────────────────────────────────────────────────────────

describe("gitStatus", () => {
  it("workspace boşsa isRepo:false döner", async () => {
    const r = await gitStatus("")
    expect(r.isRepo).toBe(false)
  })

  it("temel branch bilgisi parse edilir", async () => {
    mockGit(
      "# branch.head main\n" +
      "# branch.upstream origin/main\n" +
      "# branch.ab +2 -1\n",
    )
    const r = await gitStatus("/ws")
    expect(r.info.branch).toBe("main")
    expect(r.info.upstream).toBe("origin/main")
    expect(r.info.ahead).toBe(2)
    expect(r.info.behind).toBe(1)
    expect(r.isRepo).toBe(true)
  })

  it("değişiklik yoksa clean:true", async () => {
    mockGit("# branch.head main\n")
    const r = await gitStatus("/ws")
    expect(r.info.clean).toBe(true)
    expect(r.entries).toHaveLength(0)
  })

  it("değiştirilmiş dosya parse edilir", async () => {
    mockGit(
      "# branch.head main\n" +
      "1 M. N... 100644 100644 100644 abc def src/foo.ts\n",
    )
    const r = await gitStatus("/ws")
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].path).toBe("src/foo.ts")
    expect(r.entries[0].index).toBe("M")
    expect(r.info.clean).toBe(false)
  })

  it("untracked dosya parse edilir", async () => {
    mockGit(
      "# branch.head main\n" +
      "? new-file.ts\n",
    )
    const r = await gitStatus("/ws")
    expect(r.entries[0]).toMatchObject({ index: "?", worktree: "?", path: "new-file.ts" })
  })

  it("yeniden adlandırma parse edilir", async () => {
    mockGit(
      "# branch.head main\n" +
      "2 R. N... 100644 100644 100644 abc def R100 new.ts\told.ts\n",
    )
    const r = await gitStatus("/ws")
    expect(r.entries[0].path).toBe("new.ts")
    expect(r.entries[0].oldPath).toBe("old.ts")
  })

  it("birden fazla entry", async () => {
    mockGit(
      "# branch.head main\n" +
      "1 M. N... 100644 100644 100644 a b src/a.ts\n" +
      "? untracked.ts\n" +
      "1 D. N... 100644 000000 000000 c d deleted.ts\n",
    )
    const r = await gitStatus("/ws")
    expect(r.entries).toHaveLength(3)
  })

  it("'not a git repository' hatası → isRepo:false", async () => {
    executeFn.mockRejectedValue(new Error("fatal: not a git repository"))
    const r = await gitStatus("/not-repo")
    expect(r.isRepo).toBe(false)
  })

  it("diğer git hatası fırlatılır", async () => {
    executeFn.mockRejectedValue(new Error("network error"))
    await expect(gitStatus("/ws")).rejects.toThrow(/network/)
  })
})

// ─── assertSafeBranchName ─────────────────────────────────────────────────────

describe("assertSafeBranchName", () => {
  it("ASCII branch adları geçerli", () => {
    for (const n of ["main", "feature/login", "fix-123", "release/v1.2.3", "a_b.c"]) {
      expect(() => assertSafeBranchName(n), n).not.toThrow()
    }
  })

  it("Türkçe/Unicode branch adları geçerli (item 3 — regresyon)", () => {
    for (const n of ["özellik/yeni", "düzeltme", "fix/şğıöçü-İ", "機能/新規", "ветка"]) {
      expect(() => assertSafeBranchName(n), n).not.toThrow()
    }
  })

  it("git'in flag/ref olarak yanlış yorumlayacağı karakterler reddedilir", () => {
    for (const n of ["a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"]) {
      expect(() => assertSafeBranchName(n), n).toThrow()
    }
  })

  it("yapısal yasaklar korunur (slash/dot/lock/rezerve)", () => {
    for (const n of ["/x", "x/", "a//b", ".hidden", "x.lock", "a..b", "HEAD", "@", ""]) {
      expect(() => assertSafeBranchName(n), n).toThrow()
    }
  })

  it("'-' ile başlayan ad reddedilir (git option injection)", () => {
    for (const n of ["-f", "--orphan", "-D", "--force"]) {
      expect(() => assertSafeBranchName(n), n).toThrow()
    }
  })
})
