import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PWD_SENTINEL } from "@/lib/tools/shell-cwd"

// runBash wraps every command in `cd <cwd> && ...` where <cwd> is a per-session
// cached dir. The cache used to leak across workspace changes: once a command
// ran in workspace A, switching the session to workspace B left every later
// command pinned to A (the post-run cache write never fired because A is not
// within B). We mock runShell to capture the wrapped command and assert the
// `cd` target.
vi.mock("@/lib/exec", () => ({ runShell: vi.fn() }))

import { runShell } from "@/lib/exec"
import { runBash } from "@/lib/tools/shell"

const mockedRunShell = vi.mocked(runShell)

function cdTarget(wrapped: string): string {
  const m = wrapped.match(/^cd '([^']*)'/)
  return m ? m[1] : ""
}

describe("runBash cwd resolution", () => {
  const captured: string[] = []
  const pwds: string[] = []

  beforeEach(() => {
    captured.length = 0
    pwds.length = 0
    mockedRunShell.mockImplementation(async (cmd) => {
      captured.push(String(cmd))
      const pwd = pwds.shift() ?? "/fallback"
      return { stdout: `${PWD_SENTINEL}${pwd}\n`, stderr: "", code: 0 } as never
    })
  })

  afterEach(() => {
    mockedRunShell.mockReset()
  })

  it("drops a cached cwd that falls outside the current workspace", async () => {
    const wsA = "/work/alpha"
    const wsB = "/work/beta"
    const sid = "lock-leak-session"

    // 1) Run inside workspace A; the command ends in A/sub, which IS within A,
    //    so the cache stores /work/alpha/sub.
    pwds.push(`${wsA}/sub`)
    await runBash(wsA, "git status", { sessionId: sid })
    expect(cdTarget(captured[0])).toBe(wsA)

    // 2) Session now targets workspace B. The stale cached /work/alpha/sub is
    //    NOT within B, so the command must start in B — not the old workspace.
    pwds.push(`${wsB}/inner`)
    await runBash(wsB, "git push", { sessionId: sid })
    expect(cdTarget(captured[1])).toBe(wsB)
    expect(captured[1]).not.toContain(wsA)

    // 3) A legitimate in-workspace `cd` is still honoured on the next call: the
    //    previous run ended in B/inner (within B), so it is cached and reused.
    pwds.push(`${wsB}/inner`)
    await runBash(wsB, "ls", { sessionId: sid })
    expect(cdTarget(captured[2])).toBe(`${wsB}/inner`)
  })
})
