import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema, getMeta } from "@/lib/db/schema"
import { migrateJsonToSqlite, type JsonIndex, type JsonSource } from "@/lib/db/migrate-json"
import { listSessionMetas, loadAllMessages, countMessages, listProjects } from "@/lib/db/sessions-db"
import type { Message, Session } from "@/store/types"

let db: ReturnType<typeof nodeDb>

beforeEach(async () => {
  db = nodeDb()
  await applySchema(db)
})
afterEach(() => db.close())

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
function source(index: JsonIndex, sessions: Record<string, Session>): JsonSource {
  return {
    loadIndex: async () => index,
    loadSession: async (id: string) => sessions[id] ?? null,
  }
}

describe("migrateJsonToSqlite", () => {
  it("sessions + messages + parts + projects taşır", async () => {
    const s1 = sess("s1", {
      title: "One",
      updatedAt: 10,
      workspacePath: "/a",
      messages: [
        msg("m0", { role: "user", content: "hi" }),
        msg("m1", { role: "assistant", content: "yo", parts: [{ type: "text", text: "yo" }], modelMsgCount: 1 }),
      ],
    })
    const s2 = sess("s2", { updatedAt: 20 })
    const src = source(
      { order: ["s1", "s2"], projects: ["/a", "/b"], projectMeta: { "/a": { name: "A" } } },
      { s1, s2 },
    )

    const res = await migrateJsonToSqlite(db, src)
    expect(res).toMatchObject({ status: "migrated", sessions: 2, messages: 2, projects: 2 })

    const metas = await listSessionMetas(db)
    expect(metas.map((m) => m.id)).toEqual(["s2", "s1"]) // updatedAt DESC
    const m = await loadAllMessages(db, "s1")
    expect(m.map((x) => x.id)).toEqual(["m0", "m1"])
    expect(m[1].parts).toEqual([{ type: "text", text: "yo" }])
    expect(await countMessages(db, "s2")).toBe(0)

    const projects = await listProjects(db)
    expect(projects.map((p) => p.path)).toEqual(["/a", "/b"]) // sort korunur
    expect(projects[0].meta).toEqual({ name: "A" })
  })

  it("idempotent: ikinci çağrı atlar", async () => {
    const src = source({ order: ["s1"] }, { s1: sess("s1") })
    await migrateJsonToSqlite(db, src)
    expect(await getMeta(db, "json_imported")).toBe("1")
    expect(await migrateJsonToSqlite(db, src)).toEqual({ status: "skipped" })
  })

  it("eksik session (null) atlanır", async () => {
    const src = source({ order: ["s1", "ghost"] }, { s1: sess("s1") })
    const res = await migrateJsonToSqlite(db, src)
    expect(res).toMatchObject({ status: "migrated", sessions: 1 })
    expect((await listSessionMetas(db)).map((m) => m.id)).toEqual(["s1"])
  })
})
