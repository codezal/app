// H1: maxParallel concurrency cap must actually gate worker bodies. Regression
// test — the semaphore must defer runOne, not wrap already-running promises.
import { describe, it, expect, vi, beforeEach } from "vitest"

const storeMock = vi.hoisted(() => {
  const sessions: Record<string, Record<string, unknown>> = {}
  const getState = vi.fn(() => ({
    sessions,
    createWorkerSession: vi.fn(
      async (): Promise<string> => {
        const id = `worker-${Object.keys(sessions).length}`
        sessions[id] = { id, modelMessages: [], messages: [] }
        return id
      },
    ),
    // Freshly-created workers are transient: dispatch removes them once the
    // stream settles. Mirror that so the concurrency tests stay green.
    removeWorkerSession: vi.fn(async (id: string) => {
      delete sessions[id]
    }),
    pushMessageFor: vi.fn((sid: string, msg: { id: string; role: string }) => {
      if (!sessions[sid]) sessions[sid] = { id: sid, modelMessages: [], messages: [] }
      ;(sessions[sid].messages as Array<Record<string, unknown>>).push(msg as never)
    }),
  }))
  return { sessions, useSessionsStore: { getState } }
})

vi.mock("@/store/sessions", () => ({
  useSessionsStore: storeMock.useSessionsStore,
}))

import { setWorkerStreamFn, dispatchWorkerSessions } from "@/lib/worker-session"

function makeStreamBarrier() {
  const resolvers: Array<() => void> = []
  let active = 0
  let maxActive = 0
  const streamFn = vi.fn(async (sid: string, asstId: string) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise<void>((r) => resolvers.push(r))
    active--
    const s = storeMock.sessions[sid] as { messages: Array<{ id: string; content: string }> }
    const m = s.messages.find((x) => x.id === asstId)
    if (m) m.content = "ok"
  })
  return {
    streamFn,
    releaseAll: () => {
      while (resolvers.length) resolvers.shift()!()
    },
    get maxActive() {
      return maxActive
    },
  }
}

beforeEach(() => {
  Object.keys(storeMock.sessions).forEach((k) => delete storeMock.sessions[k])
  storeMock.useSessionsStore.getState.mockClear()
})

describe("dispatchWorkerSessions concurrency cap", () => {
  it("respects maxParallel: at most N workers run at once", async () => {
    const b = makeStreamBarrier()
    setWorkerStreamFn(b.streamFn)

    const p = dispatchWorkerSessions({
      parentSessionId: "parent-1",
      dispatches: [
        { task: "a", title: "A", provider: "openai", model: "m" },
        { task: "b", title: "B", provider: "openai", model: "m" },
        { task: "c", title: "C", provider: "openai", model: "m" },
        { task: "d", title: "D", provider: "openai", model: "m" },
      ],
      maxParallel: 2,
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(b.maxActive).toBe(2)
    expect(b.streamFn).toHaveBeenCalledTimes(2)

    b.releaseAll()
    await new Promise((r) => setTimeout(r, 0))
    b.releaseAll()
    const results = await p

    expect(b.maxActive).toBe(2)
    expect(b.streamFn).toHaveBeenCalledTimes(4)
    expect(results).toHaveLength(4)
    expect(results.every((r) => r.status === "done" && r.output === "ok")).toBe(true)
  })

  it("runs fully in parallel when maxParallel is unset", async () => {
    const b = makeStreamBarrier()
    setWorkerStreamFn(b.streamFn)

    const p = dispatchWorkerSessions({
      parentSessionId: "parent-2",
      dispatches: [
        { task: "a", title: "A", provider: "openai", model: "m" },
        { task: "b", title: "B", provider: "openai", model: "m" },
        { task: "c", title: "C", provider: "openai", model: "m" },
        { task: "d", title: "D", provider: "openai", model: "m" },
      ],
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(b.maxActive).toBe(4)

    b.releaseAll()
    await p
  })
})
