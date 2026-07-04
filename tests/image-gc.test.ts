import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema } from "@/lib/db/schema"
import { upsertSessionRow, insertMessage, referencedImageRefs } from "@/lib/db/sessions-db"
import type { Message, Session } from "@/store/types"

let db: ReturnType<typeof nodeDb>

beforeEach(async () => {
  db = nodeDb()
  await applySchema(db)
})
afterEach(() => db.close())

function sess(id: string): Session {
  return { id, title: id, updatedAt: 0, messages: [], provider: "openai" as Session["provider"], model: "gpt" }
}

describe("referencedImageRefs", () => {
  it("message images[].ref toplar; inline base64 (dataUrl) satırlarını atlar", async () => {
    await upsertSessionRow(db, sess("s1"))
    const m0: Message = {
      id: "m0",
      role: "user",
      content: "a",
      images: [{ id: "i1", ref: "imgABC123.png", mime: "image/png" }],
    }
    const m1: Message = {
      id: "m1",
      role: "user",
      content: "b",
      images: [{ id: "i2", dataUrl: "data:image/png;base64,iVBORw0KGgo", mime: "image/png" }],
    }
    await insertMessage(db, "s1", 0, m0)
    await insertMessage(db, "s1", 1, m1)

    const refs = await referencedImageRefs(db)
    expect([...refs]).toEqual(["imgABC123.png"])
  })

  it("görselsiz session → boş set", async () => {
    await upsertSessionRow(db, sess("s1"))
    await insertMessage(db, "s1", 0, { id: "m0", role: "user", content: "merhaba" })
    expect((await referencedImageRefs(db)).size).toBe(0)
  })
})
