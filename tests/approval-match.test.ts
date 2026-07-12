import { describe, it, expect, beforeEach } from "vitest"
import { matchRule, useApprovalsStore } from "@/store/approvals"
import { useSessionsStore } from "@/store/sessions"
import type { ApprovalRule } from "@/store/types"

const bash = (cmd: string) => ({ command: cmd })

describe("matchRule — temel + legacy prefix", () => {
  it("eşleşme yoksa null (ask)", () => {
    expect(matchRule([], "bash", bash("ls"))).toBeNull()
  })

  it("legacy prefix (glob'suz pattern startsWith)", () => {
    const rules: ApprovalRule[] = [{ tool: "bash", pattern: "git ", decision: "allow" }]
    expect(matchRule(rules, "bash", bash("git status"))).toBe("allow")
    expect(matchRule(rules, "bash", bash("npm i"))).toBeNull()
  })

  it("pattern'sız kural tool'un tümüne uygulanır", () => {
    const rules: ApprovalRule[] = [{ tool: "read_file", decision: "allow" }]
    expect(matchRule(rules, "read_file", { path: "/a" })).toBe("allow")
  })

  it("tool '*' her tool'u eşler", () => {
    const rules: ApprovalRule[] = [{ tool: "*", pattern: "/repo", decision: "allow" }]
    expect(matchRule(rules, "write_file", { path: "/repo/x.ts" })).toBe("allow")
  })
})

describe("matchRule — wildcard (#2)", () => {
  it("glob pattern bash command'i eşler", () => {
    const rules: ApprovalRule[] = [{ tool: "bash", pattern: "git *", decision: "allow" }]
    expect(matchRule(rules, "bash", bash("git push"))).toBe("allow")
    expect(matchRule(rules, "bash", bash("git"))).toBe("allow")
  })

  it("glob tool adı eşleşir", () => {
    const rules: ApprovalRule[] = [{ tool: "read*", pattern: "/a", decision: "allow" }]
    expect(matchRule(rules, "read_file", { path: "/a/b" })).toBe("allow")
  })
})

describe("matchRule — findLast + ask (#3)", () => {
  it("sonraki kural öncekini ezer (allow → deny)", () => {
    const rules: ApprovalRule[] = [
      { tool: "bash", pattern: "git *", decision: "allow" },
      { tool: "bash", pattern: "git push*", decision: "deny" },
    ]
    expect(matchRule(rules, "bash", bash("git status"))).toBe("allow")
    expect(matchRule(rules, "bash", bash("git push origin"))).toBe("deny")
  })

  it("'ask' allowlist içinde istisna oyar (eşleşmeyi nötrler)", () => {
    const rules: ApprovalRule[] = [
      { tool: "bash", pattern: "git *", decision: "allow" },
      { tool: "bash", pattern: "git push*", decision: "ask" },
    ]
    expect(matchRule(rules, "bash", bash("git status"))).toBe("allow")
    expect(matchRule(rules, "bash", bash("git push --force"))).toBeNull()
  })
})

describe("request — YOLO bypass + kritik escalation", () => {
  beforeEach(() => {
    useSessionsStore.setState({ active: null, activeId: null, sessions: {} })
    useApprovalsStore.setState({ queue: [], bypassWorkerIds: new Set(), projectApproved: {} })
  })

  it("YOLO worker + zararsız komut → auto-allow", async () => {
    useApprovalsStore.getState().addBypassWorker("worker_safe")
    const d = await useApprovalsStore
      .getState()
      .request("bash", bash("ls -la"), { workerId: "worker_safe" })
    expect(d).toBe("allow")
    expect(useApprovalsStore.getState().queue.length).toBe(0)
  })

  it("YOLO worker + dangerous bash (rm -rf /) → auto-allow DEĞİL, modal'a escalate", () => {
    useApprovalsStore.getState().addBypassWorker("worker_yolo")
    let resolved: unknown = "PENDING"
    void useApprovalsStore
      .getState()
      .request("bash", bash("rm -rf /"), { workerId: "worker_yolo" })
      .then((v) => {
        resolved = v
      })
    expect(useApprovalsStore.getState().queue.length).toBe(1)
    expect(resolved).toBe("PENDING")
  })

  it("background agent approval keeps run, agent, and session ownership", () => {
    void useApprovalsStore.getState().request("bash", bash("git status"), {
      workerId: "permission-1",
      workerLabel: "Reviewer",
      runId: "run-1",
      agentId: "reviewer",
      sessionId: "session-2",
    })
    expect(useApprovalsStore.getState().queue[0]).toMatchObject({
      workerLabel: "Reviewer",
      runId: "run-1",
      agentId: "reviewer",
      sessionId: "session-2",
    })
  })
})
