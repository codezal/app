import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema, getMeta, setMeta, SCHEMA_VERSION } from "@/lib/db/schema"
import {
  listSessionMetas,
  loadSessionScalar,
  upsertSessionRow,
  updateSessionColumns,
  deleteSessionRow,
  deleteSessionsOlderThan,
  countMessages,
  loadMessagesPage,
  loadAllMessages,
  persistModelMessages,
  loadModelMessages,
  firstUserMessage,
  userMessages,
  messageById,
  messageIdx,
  insertMessage,
  updateMessageRow,
  persistParts,
  deleteMessage,
  deleteMessagesFromIdx,
  modelBoundary,
  forkCopy,
  listProjects,
  upsertProject,
  deleteProject,
  setProjectsOrder,
} from "@/lib/db/sessions-db"
import type { Message, Part, Session } from "@/store/types"

let db: ReturnType<typeof nodeDb>

beforeEach(async () => {
  db = nodeDb()
  await applySchema(db)
})
afterEach(() => {
  db.close()
})

function sess(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    updatedAt: 0,
    messages: [],
    provider: "openai" as Session["provider"],
    model: "gpt",
    ...over,
  }
}
function msg(id: string, over: Partial<Message> = {}): Message {
  return { id, role: "user", content: id, ...over }
}

describe("applySchema", () => {
  it("idempotent (iki kez çalışır) + schema_version yazar", async () => {
    await applySchema(db) // ikinci kez
    expect(await getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION))
  })

  it("getMeta/setMeta round-trip", async () => {
    expect(await getMeta(db, "json_imported")).toBeNull()
    await setMeta(db, "json_imported", "1")
    expect(await getMeta(db, "json_imported")).toBe("1")
  })
})

describe("session row", () => {
  it("upsert + loadSessionScalar data alanlarını korur, messages boş döner", async () => {
    const s = sess("s1", {
      title: "Hello",
      updatedAt: 42,
      workspacePath: "/ws",
      model: "gpt-5",
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.1, turns: 1 },
      mode: "plan",
      modelMessages: [{ role: "user", content: "hi" }],
      messages: [msg("m1")],
    })
    await upsertSessionRow(db, s)
    const got = await loadSessionScalar(db, "s1")
    expect(got).not.toBeNull()
    expect(got!.title).toBe("Hello")
    expect(got!.updatedAt).toBe(42)
    expect(got!.workspacePath).toBe("/ws")
    expect(got!.model).toBe("gpt-5")
    expect(got!.usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.1, turns: 1 })
    expect(got!.mode).toBe("plan")
    expect(got!.modelMessages).toBeUndefined()
    expect(got!.messages).toEqual([])
  })

  it("modelMessages ayrı tabloya incremental yazılır + geri yüklenir", async () => {
    await upsertSessionRow(db, sess("s2", { title: "MM" }))
    await persistModelMessages(db, "s2", [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ])
    expect(await loadModelMessages(db, "s2")).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ])
    await persistModelMessages(
      db,
      "s2",
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
      2,
    )
    expect(await loadModelMessages(db, "s2")).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ])
    await persistModelMessages(db, "s2", [{ role: "user", content: "a" }])
    expect(await loadModelMessages(db, "s2")).toEqual([{ role: "user", content: "a" }])
  })

  it("upsert ikinci kez aynı id'yi günceller (REPLACE)", async () => {
    await upsertSessionRow(db, sess("s1", { title: "A", updatedAt: 1 }))
    await upsertSessionRow(db, sess("s1", { title: "B", updatedAt: 2 }))
    const got = await loadSessionScalar(db, "s1")
    expect(got!.title).toBe("B")
    expect(got!.updatedAt).toBe(2)
  })

  it("listSessionMetas updated_at DESC sıralı", async () => {
    await upsertSessionRow(db, sess("s1", { updatedAt: 10, workspacePath: "/a" }))
    await upsertSessionRow(db, sess("s2", { updatedAt: 30 }))
    await upsertSessionRow(db, sess("s3", { updatedAt: 20 }))
    const metas = await listSessionMetas(db)
    expect(metas.map((m) => m.id)).toEqual(["s2", "s3", "s1"])
    expect(metas.find((m) => m.id === "s1")!.workspacePath).toBe("/a")
  })

  it("deleteSessionRow session + mesajlarını siler", async () => {
    await upsertSessionRow(db, sess("s1"))
    await insertMessage(db, "s1", 0, msg("m1"))
    await deleteSessionRow(db, "s1")
    expect(await loadSessionScalar(db, "s1")).toBeNull()
    expect(await countMessages(db, "s1")).toBe(0)
  })

  it("deleteSessionsOlderThan: eski + pinned/archived OLMAYANları siler (retention)", async () => {
    await upsertSessionRow(db, sess("old", { updatedAt: 100 }))
    await upsertSessionRow(db, sess("oldPinned", { updatedAt: 100, pinned: true }))
    await upsertSessionRow(db, sess("oldArchived", { updatedAt: 100, archived: true }))
    await upsertSessionRow(db, sess("recent", { updatedAt: 5000 }))
    await insertMessage(db, "old", 0, msg("m1"))
    const n = await deleteSessionsOlderThan(db, 1000) // cutoff = 1000ms
    expect(n).toBe(1)
    expect(await loadSessionScalar(db, "old")).toBeNull()
    expect(await countMessages(db, "old")).toBe(0) // mesajlar da cascade silindi
    expect(await loadSessionScalar(db, "oldPinned")).not.toBeNull() // pinned korundu
    expect(await loadSessionScalar(db, "oldArchived")).not.toBeNull() // archived korundu
    expect(await loadSessionScalar(db, "recent")).not.toBeNull() // yeni korundu
  })
})

describe("messages", () => {
  beforeEach(async () => {
    await upsertSessionRow(db, sess("s1"))
  })

  it("insert + loadAllMessages idx ASC; count", async () => {
    await insertMessage(db, "s1", 0, msg("m0"))
    await insertMessage(db, "s1", 1, msg("m1", { role: "assistant", content: "hi" }))
    await insertMessage(db, "s1", 2, msg("m2"))
    const all = await loadAllMessages(db, "s1")
    expect(all.map((m) => m.id)).toEqual(["m0", "m1", "m2"])
    expect(all[1]).toMatchObject({ role: "assistant", content: "hi" })
    expect(await countMessages(db, "s1")).toBe(3)
  })

  it("loadMessagesPage son N + beforeIdx ile eski sayfa (+ oldestIdx/hasOlder)", async () => {
    for (let i = 0; i < 5; i++) await insertMessage(db, "s1", i, msg("m" + i))
    const last2 = await loadMessagesPage(db, "s1", { limit: 2 })
    expect(last2.messages.map((m) => m.id)).toEqual(["m3", "m4"])
    expect(last2.oldestIdx).toBe(3)
    expect(last2.hasOlder).toBe(true) // 5 mesaj, limit 2 → daha eski var
    const older = await loadMessagesPage(db, "s1", { beforeIdx: 3, limit: 2 })
    expect(older.messages.map((m) => m.id)).toEqual(["m1", "m2"])
    expect(older.oldestIdx).toBe(1)
    expect(older.hasOlder).toBe(true) // m0 hâlâ daha eski
    const oldest = await loadMessagesPage(db, "s1", { beforeIdx: 1, limit: 2 })
    expect(oldest.messages.map((m) => m.id)).toEqual(["m0"])
    expect(oldest.hasOlder).toBe(false) // 1 < limit → daha eski yok
  })

  it("firstUserMessage / userMessages role filtresi", async () => {
    await insertMessage(db, "s1", 0, msg("u0", { role: "user" }))
    await insertMessage(db, "s1", 1, msg("a1", { role: "assistant" }))
    await insertMessage(db, "s1", 2, msg("u2", { role: "user" }))
    expect((await firstUserMessage(db, "s1"))!.id).toBe("u0")
    expect((await userMessages(db, "s1")).map((m) => m.id)).toEqual(["u0", "u2"])
  })

  it("messageById / messageIdx", async () => {
    await insertMessage(db, "s1", 0, msg("m0"))
    await insertMessage(db, "s1", 1, msg("m1"))
    expect((await messageById(db, "s1", "m1"))!.content).toBe("m1")
    expect(await messageIdx(db, "s1", "m1")).toBe(1)
    expect(await messageById(db, "s1", "yok")).toBeNull()
    expect(await messageIdx(db, "s1", "yok")).toBeNull()
  })

  it("updateMessageRow content/data günceller, idx korunur", async () => {
    await insertMessage(db, "s1", 7, msg("m0", { content: "old" }))
    await updateMessageRow(db, "s1", msg("m0", { content: "new", pending: false }))
    expect((await loadAllMessages(db, "s1"))[0].content).toBe("new")
    expect(await messageIdx(db, "s1", "m0")).toBe(7)
  })

  it("deleteMessage tek satır; deleteMessagesFromIdx idx>=cut", async () => {
    for (let i = 0; i < 4; i++) await insertMessage(db, "s1", i, msg("m" + i))
    await deleteMessage(db, "s1", "m1")
    expect((await loadAllMessages(db, "s1")).map((m) => m.id)).toEqual(["m0", "m2", "m3"])
    await deleteMessagesFromIdx(db, "s1", 2)
    expect((await loadAllMessages(db, "s1")).map((m) => m.id)).toEqual(["m0"])
  })

  it("modelBoundary model_msg_count prefix-toplamı (NULL atlanır)", async () => {
    await insertMessage(db, "s1", 0, msg("m0", { modelMsgCount: 1 }))
    await insertMessage(db, "s1", 1, msg("m1", { modelMsgCount: 3 }))
    await insertMessage(db, "s1", 2, msg("m2")) // count yok → NULL
    expect(await modelBoundary(db, "s1", 2)).toBe(4) // idx<2: 1+3
    expect(await modelBoundary(db, "s1", 3)).toBe(4)
    expect(await modelBoundary(db, "s1", 0)).toBe(0)
  })
})

describe("parts (ayrı tablo)", () => {
  beforeEach(async () => {
    await upsertSessionRow(db, sess("s1"))
  })

  it("insertMessage parts'ı satıra yazar; loadAllMessages sırayla geri verir", async () => {
    const parts: Part[] = [
      { type: "text", text: "hello" },
      { type: "tool-call", toolCallId: "t1", toolName: "read", input: { path: "/a" } },
    ]
    await insertMessage(db, "s1", 0, msg("m0", { role: "assistant", parts }))
    expect((await loadAllMessages(db, "s1"))[0].parts).toEqual(parts)
  })

  it("persistParts: büyüyen + eklenen part'lar, son hâl doğru", async () => {
    await insertMessage(db, "s1", 0, msg("m0", { role: "assistant", parts: [{ type: "text", text: "a" }] }))
    const grown: Part[] = [
      { type: "text", text: "abc" },
      { type: "tool-call", toolCallId: "t1", toolName: "x", input: {} },
    ]
    await persistParts(db, "s1", "m0", grown, 0)
    expect((await loadAllMessages(db, "s1"))[0].parts).toEqual(grown)
  })

  it("persistParts kısalınca fazlalık satırları trim'ler", async () => {
    await insertMessage(
      db,
      "s1",
      0,
      msg("m0", {
        role: "assistant",
        parts: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
          { type: "text", text: "c" },
        ],
      }),
    )
    await persistParts(db, "s1", "m0", [{ type: "text", text: "a" }])
    expect((await loadAllMessages(db, "s1"))[0].parts).toEqual([{ type: "text", text: "a" }])
    const n = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM part WHERE session_id = ? AND message_id = ?",
      ["s1", "m0"],
    )
    expect(n[0].n).toBe(1)
  })

  it("FK cascade: deleteMessage part'ları da düşürür", async () => {
    await insertMessage(db, "s1", 0, msg("m0", { role: "assistant", parts: [{ type: "text", text: "x" }] }))
    await deleteMessage(db, "s1", "m0")
    const n = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM part WHERE message_id = ?", ["m0"])
    expect(n[0].n).toBe(0)
  })

  it("attachParts: 500+ mesaj (IN-clause chunk sınırı) part'ları doğru iliştirir", async () => {
    await upsertSessionRow(db, sess("big"))
    const N = 600
    for (let i = 0; i < N; i++) {
      await insertMessage(db, "big", i, msg(`m${i}`, { parts: [{ type: "text", text: `p${i}` }] }))
    }
    const all = await loadAllMessages(db, "big")
    expect(all.length).toBe(N)
    expect(all[0].parts).toEqual([{ type: "text", text: "p0" }])
    expect(all[499].parts).toEqual([{ type: "text", text: "p499" }])
    expect(all[500].parts).toEqual([{ type: "text", text: "p500" }])
    expect(all[599].parts).toEqual([{ type: "text", text: "p599" }])
  })
})

describe("forkCopy", () => {
  it("idx <= cut mesaj + part'larını yeni session'a kopyalar", async () => {
    await upsertSessionRow(db, sess("src"))
    await insertMessage(db, "src", 0, msg("m0", { role: "assistant", parts: [{ type: "text", text: "p0" }] }))
    for (let i = 1; i < 4; i++) await insertMessage(db, "src", i, msg("m" + i))
    await forkCopy(db, sess("fork", { title: "Forked" }), "src", 1)
    const got = await loadSessionScalar(db, "fork")
    expect(got!.title).toBe("Forked")
    const all = await loadAllMessages(db, "fork")
    expect(all.map((m) => m.id)).toEqual(["m0", "m1"])
    expect(all[0].parts).toEqual([{ type: "text", text: "p0" }])
    expect(await countMessages(db, "src")).toBe(4)
  })
})

describe("session flag kolonları (pinned/unread/archived)", () => {
  it("round-trip: kolona yazılır, data blob'una sızmaz", async () => {
    await upsertSessionRow(db, sess("s1", { pinned: true, unread: true, archived: true }))
    const got = await loadSessionScalar(db, "s1")
    expect(got!.pinned).toBe(true)
    expect(got!.unread).toBe(true)
    expect(got!.archived).toBe(true)
    await upsertSessionRow(db, sess("s2"))
    const g2 = await loadSessionScalar(db, "s2")
    expect(g2!.pinned).toBeUndefined()
    expect(g2!.unread).toBeUndefined()
    expect(g2!.archived).toBeUndefined()
    const raw = await db.select<{ data: string }>(`SELECT data FROM session WHERE id = 's1'`)
    const data = JSON.parse(raw[0].data) as Record<string, unknown>
    expect(data.pinned).toBeUndefined()
    expect(data.unread).toBeUndefined()
    expect(data.archived).toBeUndefined()
  })

  it("listSessionMetas flag'leri taşır (yalnız set olanları)", async () => {
    await upsertSessionRow(db, sess("p", { updatedAt: 2, pinned: true }))
    await upsertSessionRow(db, sess("a", { updatedAt: 1, archived: true }))
    const metas = await listSessionMetas(db)
    expect(metas.find((m) => m.id === "p")!.pinned).toBe(true)
    expect(metas.find((m) => m.id === "p")!.archived).toBeUndefined()
    expect(metas.find((m) => m.id === "a")!.archived).toBe(true)
  })

  it("updateSessionColumns yalnız verilen kolonu değiştirir, updated_at'a dokunmaz", async () => {
    await upsertSessionRow(db, sess("s1", { title: "A", updatedAt: 100 }))
    await updateSessionColumns(db, "s1", { pinned: true })
    let got = await loadSessionScalar(db, "s1")
    expect(got!.pinned).toBe(true)
    expect(got!.title).toBe("A")
    expect(got!.updatedAt).toBe(100)

    await updateSessionColumns(db, "s1", { title: "B" })
    got = await loadSessionScalar(db, "s1")
    expect(got!.title).toBe("B")
    expect(got!.pinned).toBe(true)
    expect(got!.updatedAt).toBe(100)

    await updateSessionColumns(db, "s1", { unread: false })
    expect((await loadSessionScalar(db, "s1"))!.unread).toBeUndefined()

    // move → loose (workspacePath undefined → project_path NULL)
    await upsertSessionRow(db, sess("s2", { workspacePath: "/ws", updatedAt: 5 }))
    await updateSessionColumns(db, "s2", { workspacePath: undefined })
    expect((await loadSessionScalar(db, "s2"))!.workspacePath).toBeUndefined()

    await updateSessionColumns(db, "s1", {})
  })

  it("migration eski (flag'siz) tabloya kolonları ekler, idempotent", async () => {
    const fresh = nodeDb()
    await fresh.exec(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_path TEXT, title TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, data TEXT NOT NULL)`,
    )
    await applySchema(fresh) // CREATE IF NOT EXISTS no-op + migrate ALTER ekler
    const names = (await fresh.select<{ name: string }>(`PRAGMA table_info(session)`)).map(
      (c) => c.name,
    )
    expect(names).toContain("pinned")
    expect(names).toContain("unread")
    expect(names).toContain("archived")
    await applySchema(fresh) // ikinci kez — ALTER tekrar etmez, hata yok
    await upsertSessionRow(fresh, sess("s1", { pinned: true }))
    expect((await loadSessionScalar(fresh, "s1"))!.pinned).toBe(true)
    fresh.close()
  })

  it("forkCopy(MAX) tüm mesajları kopyalar; çatal flag'leri kopyalanmaz", async () => {
    await upsertSessionRow(db, sess("src", { pinned: true, archived: true }))
    for (let i = 0; i < 5; i++) await insertMessage(db, "src", i, msg("m" + i))
    await forkCopy(db, sess("fork-all"), "src", Number.MAX_SAFE_INTEGER)
    const all = await loadAllMessages(db, "fork-all")
    expect(all.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
    const fk = await loadSessionScalar(db, "fork-all")
    expect(fk!.pinned).toBeUndefined()
    expect(fk!.archived).toBeUndefined()
  })
})

describe("project", () => {
  it("upsert + list (sort ASC) + setProjectsOrder + delete", async () => {
    await upsertProject(db, "/a", { name: "A", color: "#111" }, 0)
    await upsertProject(db, "/b", {}, 1)
    let list = await listProjects(db)
    expect(list.map((p) => p.path)).toEqual(["/a", "/b"])
    expect(list[0].meta).toEqual({ name: "A", color: "#111" })
    expect(list[1].meta).toEqual({})

    await setProjectsOrder(db, ["/b", "/a"])
    list = await listProjects(db)
    expect(list.map((p) => p.path)).toEqual(["/b", "/a"])

    await deleteProject(db, "/a")
    expect((await listProjects(db)).map((p) => p.path)).toEqual(["/b"])
  })

  it("proje-bazlı default provider/model round-trip + kısmi alan", async () => {
    // name/color + default provider/model birlikte
    await upsertProject(db, "/a", { name: "A", defaultProvider: "anthropic", defaultModel: "claude-x" }, 0)
    await upsertProject(db, "/b", { defaultProvider: "openai", defaultModel: "gpt-y" }, 1)
    await upsertProject(db, "/c", { color: "#222" }, 2)
    const list = await listProjects(db)
    expect(list.find((p) => p.path === "/a")!.meta).toEqual({
      name: "A",
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    })
    expect(list.find((p) => p.path === "/b")!.meta).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt-y",
    })
    expect(list.find((p) => p.path === "/c")!.meta).toEqual({ color: "#222" })

    await upsertProject(db, "/a", { name: "A", defaultProvider: "google", defaultModel: "gemini-z" }, 0)
    const a = (await listProjects(db)).find((p) => p.path === "/a")!.meta
    expect(a.defaultProvider).toBe("google")
    expect(a.defaultModel).toBe("gemini-z")
  })

  it("migration: eski (default kolonsuz) project tablosuna kolonları ekler, idempotent", async () => {
    const fresh = nodeDb()
    await fresh.exec(
      `CREATE TABLE project (path TEXT PRIMARY KEY, name TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0)`,
    )
    await applySchema(fresh) // CREATE IF NOT EXISTS no-op + migrate ALTER ekler
    const names = (await fresh.select<{ name: string }>(`PRAGMA table_info(project)`)).map(
      (c) => c.name,
    )
    expect(names).toContain("default_provider")
    expect(names).toContain("default_model")
    await applySchema(fresh) // ikinci kez — ALTER tekrar etmez, hata yok
    await upsertProject(fresh, "/p", { defaultProvider: "anthropic", defaultModel: "claude-x" }, 0)
    const meta = (await listProjects(fresh)).find((p) => p.path === "/p")!.meta
    expect(meta.defaultProvider).toBe("anthropic")
    expect(meta.defaultModel).toBe("claude-x")
    fresh.close()
  })

  it("migration v3→v4: modelMessages'i session.data blob'undan model_message tablosuna taşır", async () => {
    const fresh = nodeDb()
    await applySchema(fresh)
    await setMeta(fresh, "schema_version", "3")
    const data = JSON.stringify({
      provider: "openai",
      model: "gpt-5",
      modelMessages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "yo" },
      ],
    })
    await fresh.exec(
      `INSERT INTO session (id, project_path, title, updated_at, data, pinned, unread, archived)
       VALUES ('v3s', NULL, 'Eski', 1, ?, 0, 0, 0)`,
      [data],
    )
    await applySchema(fresh) // ver(3) < 4 → migration tetiklenir
    expect(await loadModelMessages(fresh, "v3s")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ])
    const got = await loadSessionScalar(fresh, "v3s")
    expect(got!.modelMessages).toBeUndefined()
    await applySchema(fresh)
    expect(await loadModelMessages(fresh, "v3s")).toHaveLength(2)
    fresh.close()
  })
})
