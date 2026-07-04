// Worker FS izolasyonu — isWriteCapable matrisi + lifecycle (setup/finalize/teardown).
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  isWriteCapable,
  setupWorkerIsolation,
  finalizeIsolation,
  teardownWorkerIsolation,
  cleanupStaleIsolation,
  type WorkerIsolation,
} from "@/lib/orchestra/isolation"
import type { WorkerConfig, WorkerDispatchResult } from "@/lib/orchestra/types"
import type { WorktreeEntry } from "@/lib/tools/worktree"
import * as wt from "@/lib/tools/worktree"
import { findAgent } from "@/lib/agents"

vi.mock("@/lib/tools/worktree", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/tools/worktree")>()
  return {
    canonicalPath: actual.canonicalPath,
    runGit: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    findRepoRoot: vi.fn(),
    listWorktrees: vi.fn(),
  }
})
vi.mock("@/lib/agents", () => ({ findAgent: vi.fn() }))

const mFindAgent = vi.mocked(findAgent)
const mRunGit = vi.mocked(wt.runGit)
const mCreateWorktree = vi.mocked(wt.createWorktree)
const mRemoveWorktree = vi.mocked(wt.removeWorktree)
const mFindRepoRoot = vi.mocked(wt.findRepoRoot)
const mListWorktrees = vi.mocked(wt.listWorktrees)

function entry(p: Partial<WorktreeEntry>): WorktreeEntry {
  return { path: "/wt", head: "abc", bare: false, detached: false, ...p }
}

function cfg(p: Partial<WorkerConfig>): WorkerConfig {
  return { idx: 1, kind: "sdk", yolo: false, ...p }
}

const baseResult: WorkerDispatchResult = {
  workerIdx: 1,
  workerId: "id",
  status: "done",
  output: "x",
  durationMs: 10,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("isWriteCapable", () => {
  it("claude-cli → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "claude-cli" }), "/ws")).toBe(true)
  })
  it("opencode-cli → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "opencode-cli" }), "/ws")).toBe(true)
  })
  it("codex-cli → true (ACP, yolo'dan bağımsız)", async () => {
    expect(await isWriteCapable(cfg({ kind: "codex-cli", yolo: true }), "/ws")).toBe(true)
    expect(await isWriteCapable(cfg({ kind: "codex-cli", yolo: false }), "/ws")).toBe(true)
  })
  it("kimi-cli → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "kimi-cli" }), "/ws")).toBe(true)
  })
  it("gemini-cli → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "gemini-cli" }), "/ws")).toBe(true)
  })
  it("acp → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "acp" }), "/ws")).toBe(true)
  })
  it("sdk presetsiz → true", async () => {
    expect(await isWriteCapable(cfg({ kind: "sdk" }), "/ws")).toBe(true)
  })
  it("sdk preset planMode → false", async () => {
    mFindAgent.mockResolvedValue({ policy: { planMode: true } } as never)
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(false)
  })
  it("sdk preset whitelist no-write → false", async () => {
    mFindAgent.mockResolvedValue({ policy: { tools: ["read_file", "grep"] } } as never)
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(false)
  })
  it("sdk preset whitelist with write → true", async () => {
    mFindAgent.mockResolvedValue({ policy: { tools: ["read_file", "write_file"] } } as never)
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(true)
  })
  it("sdk preset denyTools all-write → false", async () => {
    mFindAgent.mockResolvedValue({
      policy: { denyTools: ["write_file", "edit_file", "bash", "apply_patch"] },
    } as never)
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(false)
  })
  it("sdk preset boş policy → true", async () => {
    mFindAgent.mockResolvedValue({ policy: {} } as never)
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(true)
  })
  it("findAgent hata → true (güvenli taraf)", async () => {
    mFindAgent.mockRejectedValue(new Error("nope"))
    expect(await isWriteCapable(cfg({ kind: "sdk", presetAgent: "a" }), "/ws")).toBe(true)
  })
})

describe("setupWorkerIsolation", () => {
  it("configWorkspace undefined → noop", async () => {
    const iso = await setupWorkerIsolation(cfg({}), undefined, "id12345678", 1)
    expect(iso.isolated).toBe(false)
    expect(iso.workWorkspace).toBeUndefined()
  })
  it("read-only worker → noop, ana workspace", async () => {
    const iso = await setupWorkerIsolation(
      cfg({ kind: "codex-cli", yolo: false }),
      "/ws",
      "id12345678",
      1,
    )
    expect(iso.isolated).toBe(false)
    expect(iso.workWorkspace).toBe("/ws")
    expect(mCreateWorktree).not.toHaveBeenCalled()
  })
  it("git repo değil → skip note", async () => {
    mFindRepoRoot.mockResolvedValue(null)
    const iso = await setupWorkerIsolation(cfg({ kind: "claude-cli" }), "/ws", "id12345678", 1)
    expect(iso.isolated).toBe(false)
    expect(iso.note).toMatch(/not a git repo/)
  })
  it("git repo → worktree açılır", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mRunGit.mockResolvedValue({ code: 0, stdout: "abc123\n", stderr: "" })
    mCreateWorktree.mockResolvedValue({
      path: "/repo-wt-x",
      head: "abc",
      branch: "codezal/wk-1-1-id123456",
      bare: false,
      detached: false,
    })
    const iso = await setupWorkerIsolation(cfg({ kind: "claude-cli" }), "/ws", "id12345678", 1)
    expect(iso.isolated).toBe(true)
    expect(iso.workWorkspace).toBe("/repo-wt-x")
    expect(iso.branch).toMatch(/^codezal\/wk-1-1-/)
  })
  it("worktree create fail → fallback note", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mRunGit.mockResolvedValue({ code: 0, stdout: "abc123\n", stderr: "" })
    mCreateWorktree.mockRejectedValue(new Error("add failed"))
    const iso = await setupWorkerIsolation(cfg({ kind: "claude-cli" }), "/ws", "id12345678", 1)
    expect(iso.isolated).toBe(false)
    expect(iso.workWorkspace).toBe("/ws")
    expect(iso.note).toMatch(/worktree create failed/)
  })
})

describe("finalizeIsolation", () => {
  it("iso null → result değişmez", async () => {
    const r = await finalizeIsolation(null, baseResult, "task")
    expect(r).toEqual(baseResult)
  })
  it("izole değil + note → isolationNote", async () => {
    const iso: WorkerIsolation = {
      workWorkspace: "/ws",
      configWorkspace: "/ws",
      isolated: false,
      note: "skipped: x",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.isolationNote).toBe("skipped: x")
  })
  it("izole, değişiklik yok → committed false", async () => {
    mRunGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" })
    const iso: WorkerIsolation = {
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(false)
    expect(r.changedFiles).toEqual([])
  })
  it("izole, dirty → commit + diff", async () => {
    mRunGit
      // -z: NUL-separated porcelain
      .mockResolvedValueOnce({ code: 0, stdout: " M src/a.ts\0 M src/b.ts\0", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "deadbeef1234\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: " 2 files changed, 4 insertions\n", stderr: "" }) // diff
    const iso: WorkerIsolation = {
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(true)
    expect(r.changedFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(r.commitSha).toBe("deadbeef1234")
    expect(r.diffSummary).toMatch(/files changed/)
  })
  it("commit fail → preserve, değişiklik korunur", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M a.ts\0", stderr: "" }) // status (-z)
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "no git identity" }) // commit fail
    const iso: WorkerIsolation = {
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(false)
    expect(r.isolationNote).toMatch(/preserved/)
    expect(iso.preserve).toBe(true)
  })
  it("git status fail → preserve (veri kaybı koruması)", async () => {
    mRunGit.mockResolvedValueOnce({ code: 128, stdout: "", stderr: "index.lock exists" })
    const iso: WorkerIsolation = {
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(false)
    expect(r.isolationNote).toMatch(/preserved/)
    expect(iso.preserve).toBe(true)
  })
  it("git add fail → preserve", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M a.ts\0", stderr: "" }) // status
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied" }) // add fail
    const iso: WorkerIsolation = {
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(false)
    expect(r.isolationNote).toMatch(/preserved/)
    expect(iso.preserve).toBe(true)
  })

  it("dirty + gitignore'lu çıktı → commit + worktree preserve (item 21)", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M a.ts\0", stderr: "" }) // status -z
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "sha\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: "stat\n", stderr: "" }) // diff
      .mockResolvedValueOnce({ code: 0, stdout: "dist/out.js\0build/x.log\0", stderr: "" }) // ls-files ignored
    const iso: WorkerIsolation = {
      workWorkspace: "/wt", configWorkspace: "/ws", isolated: true,
      repoPath: "/repo", worktreePath: "/wt", branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(true)
    expect(iso.preserve).toBe(true)
    expect(r.isolationNote).toMatch(/gitignored output/)
  })

  it("değişiklik yok ama gitignore'lu çıktı → preserve (item 21)", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "dist/out.js\0", stderr: "" }) // ls-files ignored
    const iso: WorkerIsolation = {
      workWorkspace: "/wt", configWorkspace: "/ws", isolated: true,
      repoPath: "/repo", worktreePath: "/wt", branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(false)
    expect(iso.preserve).toBe(true)
    expect(r.isolationNote).toMatch(/gitignored output/)
  })

  it("dirty, gitignore'lu çıktı YOK → preserve edilmez (regresyon)", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M a.ts\0", stderr: "" }) // status
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "sha\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: "stat\n", stderr: "" }) // diff
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
    const iso: WorkerIsolation = {
      workWorkspace: "/wt", configWorkspace: "/ws", isolated: true,
      repoPath: "/repo", worktreePath: "/wt", branch: "b",
    }
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.committed).toBe(true)
    expect(iso.preserve).toBeUndefined()
  })
})

describe("teardownWorkerIsolation", () => {
  it("iso null → no-op", async () => {
    await teardownWorkerIsolation(null)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })
  it("izole değil → no-op", async () => {
    await teardownWorkerIsolation({
      workWorkspace: "/ws",
      configWorkspace: "/ws",
      isolated: false,
    })
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })
  it("preserve → silinmez", async () => {
    await teardownWorkerIsolation({
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
      preserve: true,
    })
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })
  it("izole → removeWorktree çağrılır", async () => {
    mRemoveWorktree.mockResolvedValue(undefined)
    await teardownWorkerIsolation({
      workWorkspace: "/wt",
      configWorkspace: "/ws",
      isolated: true,
      repoPath: "/repo",
      worktreePath: "/wt",
    })
    expect(mRemoveWorktree).toHaveBeenCalledWith("/repo", "/wt", true)
  })
  it("remove hata → yutulur (orphan idempotent)", async () => {
    mRemoveWorktree.mockRejectedValue(new Error("locked"))
    await expect(
      teardownWorkerIsolation({
        workWorkspace: "/wt",
        configWorkspace: "/ws",
        isolated: true,
        repoPath: "/repo",
        worktreePath: "/wt",
      }),
    ).resolves.toBeUndefined()
  })
})

// ─── finalizeIsolation: explicit add + -z parse (#2) ────────────────────────────

describe("finalizeIsolation — explicit git add", () => {
  const iso: WorkerIsolation = {
    workWorkspace: "/wt",
    configWorkspace: "/ws",
    isolated: true,
    repoPath: "/repo",
    worktreePath: "/wt",
    branch: "b",
  }

  it("git add -A KULLANMAZ — explicit path ile stage eder", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M a.ts\0?? b.ts\0", stderr: "" }) // status -z
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "sha123\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: "stat\n", stderr: "" }) // diff
    await finalizeIsolation(iso, baseResult, "task")
    const addCall = mRunGit.mock.calls.find((c) => c[1].join(" ").startsWith("add"))
    expect(addCall).toBeDefined()
    expect(addCall![1]).not.toContain("-A")
    expect(addCall![1]).toEqual(["add", "--", "a.ts", "b.ts"])
  })

  it("rename (-z) → yeni path stage edilir, eski atlanır", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: "R  src/new.ts\0src/old.ts\0", stderr: "" }) // status -z rename
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "sha\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: "stat\n", stderr: "" }) // diff
    const r = await finalizeIsolation(iso, baseResult, "task")
    expect(r.changedFiles).toEqual(["src/new.ts"])
    const addCall = mRunGit.mock.calls.find((c) => c[1].join(" ").startsWith("add"))
    expect(addCall![1]).toEqual(["add", "--", "src/new.ts"])
  })

  it("boşluklu path → arg-array ile güvenli stage (shell yok)", async () => {
    mRunGit
      .mockResolvedValueOnce({ code: 0, stdout: " M my file.ts\0", stderr: "" }) // status -z
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // add
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // commit
      .mockResolvedValueOnce({ code: 0, stdout: "sha\n", stderr: "" }) // rev-parse
      .mockResolvedValueOnce({ code: 0, stdout: "stat\n", stderr: "" }) // diff
    await finalizeIsolation(iso, baseResult, "task")
    const addCall = mRunGit.mock.calls.find((c) => c[1].join(" ").startsWith("add"))
    expect(addCall![1]).toEqual(["add", "--", "my file.ts"])
  })
})

// ─── cleanupStaleIsolation (#1) ─────────────────────────────────────────────────

describe("cleanupStaleIsolation", () => {
  it("configWorkspace undefined → no-op, findRepoRoot çağrılmaz", async () => {
    const r = await cleanupStaleIsolation(undefined)
    expect(r).toEqual({ removed: 0, preserved: 0, branchesRemoved: 0 })
    expect(mFindRepoRoot).not.toHaveBeenCalled()
  })

  it("git repo değil → no-op, listWorktrees çağrılmaz", async () => {
    mFindRepoRoot.mockResolvedValue(null)
    const r = await cleanupStaleIsolation("/ws")
    expect(r.removed).toBe(0)
    expect(mListWorktrees).not.toHaveBeenCalled()
  })

  it("listWorktrees fırlatırsa → no-op (yutulur)", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockRejectedValue(new Error("git error"))
    const r = await cleanupStaleIsolation("/ws")
    expect(r.removed).toBe(0)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("worker-olmayan branch → dokunulmaz", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([entry({ path: "/repo", branch: "main" })])
    mRunGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" })
    const r = await cleanupStaleIsolation("/ws")
    expect(r.removed).toBe(0)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("temiz worker worktree + merged branch → worktree + branch silinir", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt1", branch: "codezal/wk-1-1-aaa" }),
    ])
    mRemoveWorktree.mockResolvedValue(undefined)
    mRunGit.mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ")
      if (cmd.includes("branch --merged")) return { code: 0, stdout: "codezal/wk-1-1-aaa\n", stderr: "" }
      if (cmd.includes("status --porcelain")) return { code: 0, stdout: "", stderr: "" }
      if (cmd.includes("branch -d")) return { code: 0, stdout: "", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    })
    const r = await cleanupStaleIsolation("/ws")
    expect(r).toEqual({ removed: 1, preserved: 0, branchesRemoved: 1 })
    expect(mRemoveWorktree).toHaveBeenCalledWith("/repo", "/wt1", true)
  })

  it("temiz worker worktree + UNMERGED branch → worktree silinir, branch KORUNUR", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt1", branch: "codezal/wk-2-1-bbb" }),
    ])
    mRemoveWorktree.mockResolvedValue(undefined)
    mRunGit.mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ")
      if (cmd.includes("branch --merged")) return { code: 0, stdout: "main\n", stderr: "" }
      if (cmd.includes("status --porcelain")) return { code: 0, stdout: "", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    })
    const r = await cleanupStaleIsolation("/ws")
    expect(r.removed).toBe(1)
    expect(r.branchesRemoved).toBe(0)
    const branchDel = mRunGit.mock.calls.find((c) => c[1].join(" ").startsWith("branch -d"))
    expect(branchDel).toBeUndefined()
  })

  it("dirty worker worktree → KORUNUR (silinmez), preserved sayılır", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt1", branch: "codezal/wk-1-1-aaa" }),
    ])
    mRunGit.mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ")
      if (cmd.includes("branch --merged")) return { code: 0, stdout: "", stderr: "" }
      if (cmd.includes("status --porcelain")) return { code: 0, stdout: " M dirty.ts\n", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    })
    const r = await cleanupStaleIsolation("/ws")
    expect(r).toEqual({ removed: 0, preserved: 1, branchesRemoved: 0 })
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("temiz worktree ama gitignore'lu çıktı → KORUNUR (item 21)", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([entry({ path: "/wt1", branch: "codezal/wk-1-1-aaa" })])
    mRunGit.mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ")
      if (cmd.includes("branch --merged")) return { code: 0, stdout: "", stderr: "" }
      if (cmd.includes("status --porcelain")) return { code: 0, stdout: "", stderr: "" } // tracked temiz
      if (cmd.includes("ls-files")) return { code: 0, stdout: "dist/out.js\0", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    })
    const r = await cleanupStaleIsolation("/ws")
    expect(r).toEqual({ removed: 0, preserved: 1, branchesRemoved: 0 })
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("aktif worktree path → atlanır (çalışan worker'a dokunma)", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt-active", branch: "codezal/wk-1-1-aaa" }),
    ])
    mRunGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" })
    const r = await cleanupStaleIsolation("/ws", new Set(["/wt-active"]))
    expect(r.removed).toBe(0)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("aktif path format farkı (trailing-slash) → canonical eşleşir, atlanır", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt-active", branch: "codezal/wk-1-1-aaa" }),
    ])
    mRunGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" })
    const r = await cleanupStaleIsolation("/ws", new Set(["/wt-active/"]))
    expect(r.removed).toBe(0)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })

  it("status alınamazsa → güvenli tarafta korunur", async () => {
    mFindRepoRoot.mockResolvedValue("/repo")
    mListWorktrees.mockResolvedValue([
      entry({ path: "/wt1", branch: "codezal/wk-1-1-aaa" }),
    ])
    mRunGit.mockImplementation(async (_cwd, args) => {
      const cmd = args.join(" ")
      if (cmd.includes("branch --merged")) return { code: 0, stdout: "", stderr: "" }
      if (cmd.includes("status --porcelain")) throw new Error("worktree bozuk")
      return { code: 0, stdout: "", stderr: "" }
    })
    const r = await cleanupStaleIsolation("/ws")
    expect(r.preserved).toBe(1)
    expect(mRemoveWorktree).not.toHaveBeenCalled()
  })
})
