// izolasyon, ve granular DB write-behind (flush debounce, shadow diff).
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
import type { Message, Session } from "@/store/types"

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

function userMsg(content: string): Message {
  return { id: crypto.randomUUID(), role: "user", content }
}

function seedTwoSessions() {
  const a: Session = { id: "A", title: "A", updatedAt: 1, messages: [], provider: "openai" as Session["provider"], model: "m", mode: "build" }
  const b: Session = { id: "B", title: "B", updatedAt: 1, messages: [], provider: "openai" as Session["provider"], model: "m", mode: "build" }
  useSessionsStore.setState({
    sessions: { A: a, B: b },
    index: [
      { id: "A", title: "A", updatedAt: 1 },
      { id: "B", title: "B", updatedAt: 1 },
    ],
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
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("active ayna invariant'ı", () => {
  it("aktif session'a yazınca active === sessions[activeId] (yeni referans)", () => {
    seedTwoSessions()
    useSessionsStore.getState().pushMessageFor("A", userMsg("merhaba"))
    const st = useSessionsStore.getState()
    expect(st.active).toBe(st.sessions["A"])
    expect(st.active?.messages).toHaveLength(1)
  })

  it("arka plan session'a yazınca aktif referans DEĞİŞMEZ", () => {
    seedTwoSessions()
    const activeBefore = useSessionsStore.getState().active
    useSessionsStore.getState().pushMessageFor("B", userMsg("arka plan"))
    const st = useSessionsStore.getState()
    expect(st.active).toBe(activeBefore)
    expect(st.sessions["B"].messages).toHaveLength(1)
  })
})

describe("per-session izolasyon", () => {
  it("A ve B'ye yazmak çapraz sızmaz", () => {
    seedTwoSessions()
    const s = useSessionsStore.getState()
    s.pushMessageFor("A", userMsg("a1"))
    s.pushMessageFor("B", userMsg("b1"))
    s.pushMessageFor("A", userMsg("a2"))
    const st = useSessionsStore.getState()
    expect(st.sessions["A"].messages.map((m) => m.content)).toEqual(["a1", "a2"])
    expect(st.sessions["B"].messages.map((m) => m.content)).toEqual(["b1"])
  })
})

describe("setStreamingFor", () => {
  it("on=true ekler, on=false siler (idempotent)", () => {
    seedTwoSessions()
    const s = useSessionsStore.getState()
    s.setStreamingFor("A", true)
    expect(useSessionsStore.getState().streamingIds["A"]).toBe(true)
    s.setStreamingFor("A", true)
    expect(Object.keys(useSessionsStore.getState().streamingIds)).toEqual(["A"])
    s.setStreamingFor("A", false)
    expect(useSessionsStore.getState().streamingIds["A"]).toBeUndefined()
  })
})

describe("remove-while-streaming güvenliği", () => {
  it("remove(id) stream'i abort eder, DB'den siler, pool'dan + streamingIds'ten düşer", async () => {
    seedTwoSessions()
    useSessionsStore.getState().setStreamingFor("A", true)
    await useSessionsStore.getState().remove("A")
    expect(abortStreamSpy).toHaveBeenCalledWith("A")
    expect(dbMock.deleteSessionRow).toHaveBeenCalledWith(dbMock.db, "A")
    const st = useSessionsStore.getState()
    expect(st.sessions["A"]).toBeUndefined()
    expect(st.streamingIds["A"]).toBeUndefined()
  })

  it("silinen session'a geç yazma (mut) no-op — crash yok", async () => {
    seedTwoSessions()
    await useSessionsStore.getState().remove("A")
    expect(() => useSessionsStore.getState().pushMessageFor("A", userMsg("geç"))).not.toThrow()
    expect(useSessionsStore.getState().sessions["A"]).toBeUndefined()
  })

  it("aktif session silinince aynı projedeki en son güncellenen session'ı açar", async () => {
    const deleted: Session = {
      id: "deleted",
      title: "Deleted",
      updatedAt: 40,
      messages: [],
      provider: "openai" as Session["provider"],
      model: "m",
      workspacePath: "/project",
    }
    const sameOlder: Session = { ...deleted, id: "same-older", updatedAt: 10 }
    const sameLatest: Session = { ...deleted, id: "same-latest", updatedAt: 30 }
    const sameArchived: Session = { ...deleted, id: "same-archived", updatedAt: 60, archived: true }
    const otherLatest: Session = {
      ...deleted,
      id: "other-latest",
      updatedAt: 50,
      workspacePath: undefined,
    }
    useSessionsStore.setState({
      sessions: {
        deleted,
        "same-older": sameOlder,
        "same-latest": sameLatest,
        "same-archived": sameArchived,
        "other-latest": otherLatest,
      },
      index: [
        { id: "deleted", title: "Deleted", updatedAt: 40, workspacePath: "/project" },
        { id: "other-latest", title: "Other latest", updatedAt: 50 },
        { id: "same-older", title: "Same older", updatedAt: 10, workspacePath: "/project" },
        { id: "same-latest", title: "Same latest", updatedAt: 30, workspacePath: "/project" },
        {
          id: "same-archived",
          title: "Same archived",
          updatedAt: 60,
          workspacePath: "/project",
          archived: true,
        },
      ],
      activeId: "deleted",
      active: deleted,
      isDraft: false,
    })

    await useSessionsStore.getState().remove("deleted")

    const st = useSessionsStore.getState()
    expect(st.activeId).toBe("same-latest")
    expect(st.active).toBe(st.sessions["same-latest"])
  })
})

describe("granular DB write-behind (flush debounce)", () => {
  it("yazma 600ms sonra session'ı flush eder (upsertSessionRow + insertMessageInto)", async () => {
    seedTwoSessions()
    useSessionsStore.getState().pushMessageFor("A", userMsg("x"))
    expect(dbMock.upsertSessionRow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(dbMock.upsertSessionRow.mock.calls.some((c) => (c[1] as Session)?.id === "A")).toBe(true)
    expect(dbMock.insertMessageInto).toHaveBeenCalled() // yeni mesaj = 1 INSERT
  })

  it("hızlı ardışık yazılar tek flush'a (tek tx) debounce edilir", async () => {
    seedTwoSessions()
    const s = useSessionsStore.getState()
    s.pushMessageFor("A", userMsg("1"))
    s.pushMessageFor("A", userMsg("2"))
    s.pushMessageFor("A", userMsg("3"))
    await vi.advanceTimersByTimeAsync(600)
    expect(dbMock.db.tx).toHaveBeenCalledTimes(1) // tek session, tek flush
  })

  it("iki farklı session ayrı ayrı flush edilir (iki tx)", async () => {
    seedTwoSessions()
    const s = useSessionsStore.getState()
    s.pushMessageFor("A", userMsg("a"))
    s.pushMessageFor("B", userMsg("b"))
    await vi.advanceTimersByTimeAsync(600)
    expect(dbMock.db.tx).toHaveBeenCalledTimes(2)
  })
})

describe("patchSessionMeta", () => {
  it("index + pool + active'i patch'ler, updateSessionColumns'u çağırır", async () => {
    seedTwoSessions()
    await useSessionsStore.getState().patchSessionMeta("A", { pinned: true, title: "A2" })
    const st = useSessionsStore.getState()
    expect(st.index.find((m) => m.id === "A")!.pinned).toBe(true)
    expect(st.index.find((m) => m.id === "A")!.title).toBe("A2")
    expect(st.sessions["A"].pinned).toBe(true)
    expect(st.sessions["A"].title).toBe("A2")
    expect(st.active!.pinned).toBe(true) // A aktif → ayna senkron
    expect(dbMock.updateSessionColumns).toHaveBeenCalledWith(dbMock.db, "A", {
      pinned: true,
      title: "A2",
    })
  })

  it("yüklü olmayan session'da yalnız index + DB güncellenir (pool'a yüklemez)", async () => {
    useSessionsStore.setState({
      index: [{ id: "X", title: "X", updatedAt: 1 }],
      sessions: {},
      activeId: null,
      active: null,
    })
    await useSessionsStore.getState().patchSessionMeta("X", { archived: true })
    const st = useSessionsStore.getState()
    expect(st.index.find((m) => m.id === "X")!.archived).toBe(true)
    expect(st.sessions["X"]).toBeUndefined()
    expect(dbMock.updateSessionColumns).toHaveBeenCalledWith(dbMock.db, "X", { archived: true })
  })

  it("flag false → index'ten alan silinir (truthy okuma)", async () => {
    seedTwoSessions()
    await useSessionsStore.getState().patchSessionMeta("A", { pinned: true })
    await useSessionsStore.getState().patchSessionMeta("A", { pinned: false })
    expect(useSessionsStore.getState().index.find((m) => m.id === "A")!.pinned).toBeUndefined()
  })
})

describe("forkSession", () => {
  it("tüm session'ı çoğaltır (forkCopy MAX), yeni session aktif olur", async () => {
    seedTwoSessions()
    const id = await useSessionsStore.getState().forkSession("A")
    const st = useSessionsStore.getState()
    expect(st.activeId).toBe(id)
    expect(st.sessions[id]).toBeDefined()
    expect(st.sessions[id].title).toBe("A (çatal)")
    expect(st.index[0].id).toBe(id)
    expect(dbMock.forkCopy).toHaveBeenCalled()
    expect(dbMock.forkCopy.mock.calls[0][3]).toBe(Number.MAX_SAFE_INTEGER)
    expect(st.sessions[id].pinned).toBeUndefined()
  })
})

describe("open → unread temizler", () => {
  it("unread session açılınca updateSessionColumns(unread:false) çağrılır", async () => {
    seedTwoSessions()
    useSessionsStore.setState((s) => ({
      sessions: { ...s.sessions, B: { ...s.sessions["B"], unread: true } },
      index: s.index.map((m) => (m.id === "B" ? { ...m, unread: true } : m)),
    }))
    await useSessionsStore.getState().open("B")
    const st = useSessionsStore.getState()
    expect(st.activeId).toBe("B")
    expect(st.index.find((m) => m.id === "B")!.unread).toBeUndefined()
    expect(dbMock.updateSessionColumns).toHaveBeenCalledWith(dbMock.db, "B", { unread: false })
  })

  it("okunmuş session açılınca updateSessionColumns çağrılmaz", async () => {
    seedTwoSessions()
    await useSessionsStore.getState().open("B")
    expect(dbMock.updateSessionColumns).not.toHaveBeenCalled()
  })
})

describe("lastSessionContext (yeni session miras alır)", () => {
  const FALLBACK = { provider: "anthropic" as Session["provider"], model: "fb", reasoningEffort: "high" as const }

  it("foreground aktif session'dan provider/model/thinking + klasörü döner", async () => {
    seedTwoSessions()
    useSessionsStore.setState((s) => ({
      sessions: { ...s.sessions, A: { ...s.sessions["A"], reasoningEffort: "low", workspacePath: "/ws/a" } },
      active: { ...s.active!, reasoningEffort: "low", workspacePath: "/ws/a" },
    }))
    const ctx = await useSessionsStore.getState().lastSessionContext(FALLBACK)
    expect(ctx).toEqual({ provider: "openai", model: "m", reasoningEffort: "low", workspacePath: "/ws/a" })
  })

  it("aktif session'da reasoningEffort/workspace yoksa undefined bırakır (fallback'a kaçmaz)", async () => {
    seedTwoSessions() // A: provider openai, model m, override yok
    const ctx = await useSessionsStore.getState().lastSessionContext(FALLBACK)
    expect(ctx.provider).toBe("openai")
    expect(ctx.model).toBe("m")
    expect(ctx.reasoningEffort).toBeUndefined()
    expect(ctx.workspacePath).toBeUndefined()
  })

  it("aktif yoksa pool'daki en son güncellenen session'dan (index[0]) döner — scalar yüklemez", async () => {
    const b: Session = {
      id: "B", title: "B", updatedAt: 1, messages: [],
      provider: "google" as Session["provider"], model: "g", mode: "build",
      reasoningEffort: "minimal", workspacePath: "/proj/b",
    }
    useSessionsStore.setState({ sessions: { B: b }, index: [{ id: "B", title: "B", updatedAt: 1 }], activeId: null, active: null })
    const ctx = await useSessionsStore.getState().lastSessionContext(FALLBACK)
    expect(ctx).toEqual({ provider: "google", model: "g", reasoningEffort: "minimal", workspacePath: "/proj/b" })
    expect(dbMock.loadSessionScalar).not.toHaveBeenCalled()
  })

  it("aktif yok + index[0] pool'da değil → loadSessionScalar ile yükler", async () => {
    dbMock.loadSessionScalar.mockResolvedValueOnce({
      id: "Z", title: "Z", updatedAt: 9, messages: [],
      provider: "xai", model: "grok", mode: "build",
      reasoningEffort: "high", workspacePath: "/scalar/z",
    } as unknown as Session)
    useSessionsStore.setState({ sessions: {}, index: [{ id: "Z", title: "Z", updatedAt: 9 }], activeId: null, active: null })
    const ctx = await useSessionsStore.getState().lastSessionContext(FALLBACK)
    expect(dbMock.loadSessionScalar).toHaveBeenCalledWith(dbMock.db, "Z")
    expect(ctx).toEqual({ provider: "xai", model: "grok", reasoningEffort: "high", workspacePath: "/scalar/z" })
  })

  it("hiç session yoksa fallback (global default) döner", async () => {
    const ctx = await useSessionsStore.getState().lastSessionContext(FALLBACK)
    expect(ctx).toEqual(FALLBACK)
  })
})

describe("detached session (split sağ pane)", () => {
  const prov = "openai" as Session["provider"]

  it("createDetached pool'a ekler; index/active/isDraft'a dokunmaz", () => {
    seedTwoSessions() // A aktif
    const id = useSessionsStore.getState().createDetached(prov, "m")
    const st = useSessionsStore.getState()
    expect(st.sessions[id]).toBeTruthy() // pool'da var
    expect(st.index.some((m) => m.id === id)).toBe(false) // sidebar'da yok
    expect(st.activeId).toBe("A")
    expect(st.isDraft).toBe(false)
  })

  it("commitDetached index'e ekler + DB'ye yazar; ikinci çağrı duplicate yapmaz", async () => {
    seedTwoSessions()
    const id = useSessionsStore.getState().createDetached(prov, "m")
    await useSessionsStore.getState().commitDetached(id)
    expect(useSessionsStore.getState().index.some((m) => m.id === id)).toBe(true)
    expect(dbMock.upsertSessionRow).toHaveBeenCalled()
    const before = useSessionsStore.getState().index.length
    await useSessionsStore.getState().commitDetached(id) // zaten commit'li → no-op
    expect(useSessionsStore.getState().index.length).toBe(before)
  })

  it("dropDetached boş + commit edilmemiş session'ı pool'dan siler", () => {
    seedTwoSessions()
    const id = useSessionsStore.getState().createDetached(prov, "m")
    useSessionsStore.getState().dropDetached(id)
    expect(useSessionsStore.getState().sessions[id]).toBeUndefined()
  })

  it("dropDetached commit'li session'a dokunmaz", async () => {
    seedTwoSessions()
    const id = useSessionsStore.getState().createDetached(prov, "m")
    await useSessionsStore.getState().commitDetached(id)
    useSessionsStore.getState().dropDetached(id)
    expect(useSessionsStore.getState().sessions[id]).toBeTruthy()
  })

  it("dropDetached mesajlı session'a dokunmaz", () => {
    seedTwoSessions()
    const id = useSessionsStore.getState().createDetached(prov, "m")
    useSessionsStore.getState().pushMessageFor(id, userMsg("merhaba"))
    useSessionsStore.getState().dropDetached(id)
    expect(useSessionsStore.getState().sessions[id]).toBeTruthy()
  })

  it("commit edilmemiş detached'e mut (mode değişimi) → DB'ye yazılmaz", async () => {
    seedTwoSessions()
    const id = useSessionsStore.getState().createDetached(prov, "m")
    useSessionsStore.getState().setModeFor(id, "plan")
    await vi.runAllTimersAsync()
    expect(dbMock.upsertSessionRow).not.toHaveBeenCalled()
  })
})

describe("commitDraft proje hafızası", () => {
  it("draft commit olunca session'ın provider/model'ini projectMeta'ya yazar", async () => {
    const st = useSessionsStore.getState()
    st.createDraft("deepseek" as Session["provider"], "deepseek-v4", "/ws/erp")
    expect(useSessionsStore.getState().active?.delegationMode).toBe("solo")
    st.updateActiveMeta({ provider: "moonshot" as Session["provider"], model: "kimi-k2.6" })
    await useSessionsStore.getState().commitDraft()
    const after = useSessionsStore.getState()
    expect(after.projectMeta["/ws/erp"]).toEqual({
      defaultProvider: "moonshot",
      defaultModel: "kimi-k2.6",
    })
    expect(after.projects).toContain("/ws/erp")
    expect(dbMock.upsertProject).toHaveBeenCalled()
  })

  it("mevcut proje meta'sını (ad/renk) korur, yalnız model alanlarını günceller", async () => {
    useSessionsStore.setState({ projectMeta: { "/ws/erp": { name: "ERP", color: "#abc" } } })
    const st = useSessionsStore.getState()
    st.createDraft("anthropic" as Session["provider"], "claude-x", "/ws/erp")
    await useSessionsStore.getState().commitDraft()
    expect(useSessionsStore.getState().projectMeta["/ws/erp"]).toEqual({
      name: "ERP",
      color: "#abc",
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    })
  })

  it("workspace'siz draft commit'inde projectMeta yazılmaz", async () => {
    const st = useSessionsStore.getState()
    st.createDraft("openai" as Session["provider"], "gpt-x")
    await useSessionsStore.getState().commitDraft()
    expect(Object.keys(useSessionsStore.getState().projectMeta)).toHaveLength(0)
  })
})

describe("mesaj pencereleme (windowed load + load older)", () => {
  const mkMsgs = (from: number, to: number): Message[] => {
    const out: Message[] = []
    for (let i = from; i <= to; i++) out.push({ id: `m${i}`, role: "user", content: `msg ${i}` })
    return out
  }
  const scalar = {
    id: "BIG",
    title: "Big",
    updatedAt: 1,
    provider: "openai" as Session["provider"],
    model: "m",
    mode: "build" as Session["mode"],
  }

  it("open() son sayfayı yükler + hasOlder=true (büyük sohbet tümünü yüklemez)", async () => {
    dbMock.loadSessionScalar.mockResolvedValueOnce(scalar)
    dbMock.loadMessagesPage.mockResolvedValueOnce({ messages: mkMsgs(50, 249), oldestIdx: 50, hasOlder: true })
    dbMock.nextMessageSeq.mockResolvedValueOnce(250)
    await useSessionsStore.getState().open("BIG")
    const st = useSessionsStore.getState()
    expect(st.active?.messages).toHaveLength(200)
    expect(st.active?.messages[0]?.id).toBe("m50")
    expect(st.msgWindow["BIG"]).toEqual({ oldestIdx: 50, hasOlder: true })
    expect(dbMock.loadAllMessages).not.toHaveBeenCalled()
  })

  it("loadOlderMessages eskiyi başa ekler + hasOlder/oldestIdx günceller", async () => {
    dbMock.loadSessionScalar.mockResolvedValueOnce(scalar)
    dbMock.loadMessagesPage.mockResolvedValueOnce({ messages: mkMsgs(50, 249), oldestIdx: 50, hasOlder: true })
    dbMock.nextMessageSeq.mockResolvedValueOnce(250)
    await useSessionsStore.getState().open("BIG")
    dbMock.loadMessagesPage.mockResolvedValueOnce({ messages: mkMsgs(0, 49), oldestIdx: 0, hasOlder: false })
    const added = await useSessionsStore.getState().loadOlderMessages("BIG")
    expect(added).toBe(50)
    const st = useSessionsStore.getState()
    expect(st.active?.messages).toHaveLength(250)
    expect(st.active?.messages[0]?.id).toBe("m0")
    expect(st.active?.messages[249]?.id).toBe("m249")
    expect(st.active).toBe(st.sessions["BIG"])
    expect(st.msgWindow["BIG"]).toEqual({ oldestIdx: 0, hasOlder: false })
  })

  it("daha eski yokken loadOlderMessages no-op", async () => {
    useSessionsStore.setState({
      sessions: { BIG: { ...scalar, messages: mkMsgs(0, 9) } as Session },
      activeId: "BIG",
      active: { ...scalar, messages: mkMsgs(0, 9) } as Session,
      msgWindow: { BIG: { oldestIdx: 0, hasOlder: false } },
    })
    const added = await useSessionsStore.getState().loadOlderMessages("BIG")
    expect(added).toBe(0)
    expect(dbMock.loadMessagesPage).not.toHaveBeenCalled()
  })

  it("loadOlderMessages sonrası flush eskiyi RE-INSERT/DELETE etmez (shadow güvenli)", async () => {
    dbMock.loadSessionScalar.mockResolvedValueOnce(scalar)
    dbMock.loadMessagesPage.mockResolvedValueOnce({ messages: mkMsgs(50, 249), oldestIdx: 50, hasOlder: true })
    dbMock.nextMessageSeq.mockResolvedValueOnce(250)
    await useSessionsStore.getState().open("BIG")
    dbMock.loadMessagesPage.mockResolvedValueOnce({ messages: mkMsgs(0, 49), oldestIdx: 0, hasOlder: false })
    await useSessionsStore.getState().loadOlderMessages("BIG")
    useSessionsStore.setState({ index: [{ id: "BIG", title: "Big", updatedAt: 1 }] })
    dbMock.insertMessageInto.mockClear()
    dbMock.deleteMessage.mockClear()
    useSessionsStore.getState().pushMessageFor("BIG", userMsg("yeni"))
    await vi.advanceTimersByTimeAsync(600)
    expect(dbMock.insertMessageInto).toHaveBeenCalledTimes(1)
    expect(dbMock.deleteMessage).not.toHaveBeenCalled()
  })

  it("truncateAfter system/info mesajlarını model boundary'de 0 sayar", () => {
    const s: Session = {
      id: "A",
      title: "A",
      updatedAt: 1,
      messages: [
        { id: "u1", role: "user", content: "hi", modelMsgCount: 1 },
        { id: "a1", role: "assistant", content: "tools", modelMsgCount: 3 },
        { id: "sys1", role: "system", content: "compacted" },
        { id: "u2", role: "user", content: "again", modelMsgCount: 1 },
        { id: "a2", role: "assistant", content: "done", modelMsgCount: 2 },
        { id: "sys2", role: "system", content: "tail" },
      ],
      modelMessages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "tool call" },
        { role: "tool", content: "tool result" },
        { role: "assistant", content: "tools" },
        { role: "user", content: "again" },
        { role: "assistant", content: "tool call 2" },
        { role: "assistant", content: "done" },
        { role: "user", content: "tail should cut" },
      ] as Session["modelMessages"],
      provider: "openai" as Session["provider"],
      model: "m",
      mode: "build",
    }
    useSessionsStore.setState({
      sessions: { A: s },
      index: [{ id: "A", title: "A", updatedAt: 1 }],
      activeId: "A",
      active: s,
      isDraft: false,
    })

    useSessionsStore.getState().truncateAfter("a2")

    const active = useSessionsStore.getState().active!
    expect(active.messages.map((m) => m.id)).toEqual(["u1", "a1", "sys1", "u2", "a2"])
    expect(active.modelMessages).toHaveLength(7)
  })

  // ---- revert / unrevert (bayat-undo guard) ----
  function seedRevertSession() {
    const s: Session = {
      id: "A",
      title: "A",
      updatedAt: 1,
      messages: [
        { id: "u1", role: "user", content: "hi", modelMsgCount: 1 },
        { id: "a1", role: "assistant", content: "done", modelMsgCount: 1, snapshotBase: "base-hash" },
      ],
      modelMessages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "done" },
      ] as Session["modelMessages"],
      provider: "openai" as Session["provider"],
      model: "m",
      mode: "build",
      workspacePath: "/ws",
    }
    useSessionsStore.setState({
      sessions: { A: s },
      index: [{ id: "A", title: "A", updatedAt: 1 }],
      activeId: "A",
      active: s,
      isDraft: false,
    })
  }

  it("revert + hemen unrevert → kesilen kuyruğu geri yükler", async () => {
    seedRevertSession()
    const r = await useSessionsStore.getState().revertToBeforeMessage("a1")
    expect(r.canUndo).toBe(true)
    expect(useSessionsStore.getState().active!.messages.map((m) => m.id)).toEqual(["u1"])
    const undo = await useSessionsStore.getState().unrevertSession("A")
    expect(undo).not.toBeNull()
    expect(useSessionsStore.getState().active!.messages.map((m) => m.id)).toEqual(["u1", "a1"])
  })

  it("revert sonrası yeni mesaj → bayat undo REDDEDİLİR (clobber/sıra bozulması yok)", async () => {
    seedRevertSession()
    await useSessionsStore.getState().revertToBeforeMessage("a1")
    useSessionsStore.getState().pushMessageFor("A", { id: "u2", role: "user", content: "new" })
    const undo = await useSessionsStore.getState().unrevertSession("A")
    expect(undo).toBeNull()
    expect(useSessionsStore.getState().active!.messages.map((m) => m.id)).toEqual(["u1", "u2"])
  })
})
