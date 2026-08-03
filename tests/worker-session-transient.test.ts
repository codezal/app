// Worker (parallel agent) sessions are transient: dispatchWorkerSessions
// creates a session per dispatch, runs it, then removes it (store + DB) once
// the stream settles. Resumed sessions (opencode task_id) are the caller's
// and survive. Runs against the real store with a mocked DB layer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const dbMock = vi.hoisted(() => {
  const fakeT = { exec: vi.fn(async () => {}), select: vi.fn(async () => []), tx: vi.fn() }
  return {
    fakeT,
    db: {
      exec: vi.fn(async () => {}),
      select: vi.fn(async () => []),
      tx: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(fakeT)),
    },
    bootstrapDb: vi.fn(async () => {}),
    upsertSessionRow: vi.fn(async () => {}),
    insertMessageInto: vi.fn(async () => {}),
    updateMessageRow: vi.fn(async () => {}),
    persistParts: vi.fn(async () => {}),
    persistModelMessages: vi.fn(async () => {}),
    loadModelMessages: vi.fn(async () => []),
    deleteMessage: vi.fn(async () => {}),
    deleteSessionRow: vi.fn(async () => {}),
    forkCopy: vi.fn(async () => {}),
    updateSessionColumns: vi.fn(async () => {}),
    upsertProject: vi.fn(async () => {}),
    deleteProject: vi.fn(async () => {}),
    setProjectsOrder: vi.fn(async () => {}),
    listSessionMetas: vi.fn(async () => []),
    listProjects: vi.fn(async () => []),
    loadSessionScalar: vi.fn(async () => null),
    loadAllMessages: vi.fn(async () => []),
    loadMessagesPage: vi.fn(async () => ({ messages: [], oldestIdx: null, hasOlder: false })),
    nextMessageSeq: vi.fn(async () => 0),
    messageIdx: vi.fn(async () => 0),
  }
})
vi.mock("@/lib/db", () => ({
  db: dbMock.db,
  bootstrapDb: dbMock.bootstrapDb,
  upsertSessionRow: dbMock.upsertSessionRow,
  insertMessageInto: dbMock.insertMessageInto,
  updateMessageRow: dbMock.updateMessageRow,
  persistParts: dbMock.persistParts,
  persistModelMessages: dbMock.persistModelMessages,
  loadModelMessages: dbMock.loadModelMessages,
  deleteMessage: dbMock.deleteMessage,
  deleteSessionRow: dbMock.deleteSessionRow,
  forkCopy: dbMock.forkCopy,
  updateSessionColumns: dbMock.updateSessionColumns,
  upsertProject: dbMock.upsertProject,
  deleteProject: dbMock.deleteProject,
  setProjectsOrder: dbMock.setProjectsOrder,
  listSessionMetas: dbMock.listSessionMetas,
  listProjects: dbMock.listProjects,
  loadSessionScalar: dbMock.loadSessionScalar,
  loadAllMessages: dbMock.loadAllMessages,
  loadMessagesPage: dbMock.loadMessagesPage,
  nextMessageSeq: dbMock.nextMessageSeq,
  messageIdx: dbMock.messageIdx,
}))
vi.mock("@/lib/snapshots", () => ({
  checkpoint: vi.fn(async () => "redo-hash"),
  revertToBase: vi.fn(async () => ({ restored: 0, deleted: 0 })),
  clearSession: vi.fn(async () => {}),
}))
const { abortStreamSpy } = vi.hoisted(() => ({ abortStreamSpy: vi.fn() }))
vi.mock("@/lib/run-registry", () => ({
  abortStream: abortStreamSpy,
  setStreamAbort: vi.fn(),
  clearStreamAbort: vi.fn(),
}))

import { useSessionsStore } from "@/store/sessions"
import type { Session } from "@/store/types"
import { dispatchWorkerSessions, setWorkerStreamFn } from "@/lib/worker-session"

function resetStore() {
  useSessionsStore.setState({
    index: [],
    projects: [],
    projectMeta: {},
    activeId: null,
    sessions: {},
    active: null,
    streamingIds: {},
    loaded: false,
    isDraft: false,
  })
}

function seedParent() {
  const a: Session = {
    id: "A",
    title: "Parent",
    updatedAt: 1,
    messages: [],
    provider: "openai" as Session["provider"],
    model: "m",
    mode: "build",
  }
  useSessionsStore.setState({
    sessions: { A: a },
    index: [{ id: "A", title: "Parent", updatedAt: 1 }],
    activeId: "A",
    active: a,
    isDraft: false,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of Object.values(dbMock)) if (typeof (fn as { mockClear?: () => void }).mockClear === "function") (fn as { mockClear: () => void }).mockClear()
  dbMock.db.tx.mockClear()
  abortStreamSpy.mockClear()
  resetStore()
  // Default fake stream: settle the pending assistant bubble with some output.
  setWorkerStreamFn(async (sid, asstMsgId) => {
    const st = useSessionsStore.getState()
    st.patchMessageFor(sid, asstMsgId, { content: "final output", pending: false })
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("dispatchWorkerSessions — transient workers", () => {
  it("worker session tamamlanınca store ve DB'den silinir", async () => {
    seedParent()
    const results = await dispatchWorkerSessions({
      parentSessionId: "A",
      dispatches: [{ task: "do the thing", title: "⚙ worker · task-1", provider: "openai", model: "m" }],
    })
    const st = useSessionsStore.getState()
    expect(results[0].status).toBe("done")
    expect(results[0].output).toBe("final output")
    const sid = results[0].workerSessionId
    expect(sid).toBeTruthy()
    // Removed from the store index + pool.
    expect(st.sessions[sid]).toBeUndefined()
    expect(st.index.some((m) => m.id === sid)).toBe(false)
    // DB row deleted; parent survives.
    expect(dbMock.deleteSessionRow).toHaveBeenCalledWith(dbMock.db, sid)
    expect(st.sessions["A"]).toBeTruthy()
    expect(st.activeId).toBe("A")
  })

  it("aktif worker silinince ana session yeniden açılır", async () => {
    seedParent()
    const sid = await useSessionsStore.getState().createWorkerSession({
      ownerSessionId: "A",
      title: "⚙ worker",
      provider: "openai",
      model: "m",
    })
    useSessionsStore.setState({
      activeId: sid,
      active: useSessionsStore.getState().sessions[sid],
      isDraft: false,
    })
    await useSessionsStore.getState().removeWorkerSession(sid)
    const st = useSessionsStore.getState()
    expect(st.sessions[sid]).toBeUndefined()
    expect(st.activeId).toBe("A")
    expect(st.active?.id).toBe("A")
  })

  it("resumeSessionId ile sürdürülen session silinmez", async () => {
    seedParent()
    const w: Session = {
      id: "W",
      title: "resumed worker",
      updatedAt: 1,
      messages: [],
      provider: "openai" as Session["provider"],
      model: "m",
      mode: "build",
      ownerSessionId: "A",
    }
    useSessionsStore.setState((st) => ({
      sessions: { ...st.sessions, W: w },
      index: [...st.index, { id: "W", title: "resumed worker", updatedAt: 1 }],
    }))
    const results = await dispatchWorkerSessions({
      parentSessionId: "A",
      dispatches: [{ task: "continue", title: "resumed worker", provider: "openai", model: "m", resumeSessionId: "W" }],
    })
    const st = useSessionsStore.getState()
    expect(results[0].workerSessionId).toBe("W")
    expect(st.sessions["W"]).toBeTruthy()
    expect(dbMock.deleteSessionRow).not.toHaveBeenCalled()
  })

  it("stream hatası olan worker da yine de silinir", async () => {
    seedParent()
    setWorkerStreamFn(async () => {
      throw new Error("boom")
    })
    const results = await dispatchWorkerSessions({
      parentSessionId: "A",
      dispatches: [{ task: "will fail", title: "⚙ worker", provider: "openai", model: "m" }],
    })
    const st = useSessionsStore.getState()
    expect(results[0].status).toBe("error")
    const sid = results[0].workerSessionId
    expect(st.sessions[sid]).toBeUndefined()
    expect(st.index.some((m) => m.id === sid)).toBe(false)
    expect(st.sessions["A"]).toBeTruthy()
  })
})
