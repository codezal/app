import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema } from "@/lib/db/schema"
import {
  loadProjectPermission,
  saveProjectPermission,
  deleteProject,
  upsertProject,
  upsertSessionRow,
  loadSessionScalar,
} from "@/lib/db/sessions-db"
import type { PermissionRule } from "@/lib/permission/types"
import type { Session } from "@/store/types"

let db: ReturnType<typeof nodeDb>

beforeEach(async () => {
  db = nodeDb()
  await applySchema(db)
})
afterEach(() => db.close())

const rule = (permission: string, pattern: string): PermissionRule => ({ permission, pattern, action: "allow" })

describe("project_permission — round-trip", () => {
  it("kayıt yokken [] döner", async () => {
    expect(await loadProjectPermission(db, "/ws")).toEqual([])
  })

  it("save → load aynı kuralları döndürür", async () => {
    const rules = [rule("edit", "*"), rule("bash", "git *")]
    await saveProjectPermission(db, "/ws", rules, 1)
    expect(await loadProjectPermission(db, "/ws")).toEqual(rules)
  })

  it("upsert — ikinci save öncekini ezer", async () => {
    await saveProjectPermission(db, "/ws", [rule("edit", "*")], 1)
    await saveProjectPermission(db, "/ws", [rule("bash", "*")], 2)
    expect(await loadProjectPermission(db, "/ws")).toEqual([rule("bash", "*")])
  })

  it("proje başına izole — farklı workspace farklı kurallar", async () => {
    await saveProjectPermission(db, "/a", [rule("edit", "*")], 1)
    await saveProjectPermission(db, "/b", [rule("bash", "*")], 1)
    expect(await loadProjectPermission(db, "/a")).toEqual([rule("edit", "*")])
    expect(await loadProjectPermission(db, "/b")).toEqual([rule("bash", "*")])
  })

  it("deleteProject onaylanmış izinleri de temizler", async () => {
    await upsertProject(db, "/ws", { name: "WS" }, 0)
    await saveProjectPermission(db, "/ws", [rule("edit", "*")], 1)
    await deleteProject(db, "/ws")
    expect(await loadProjectPermission(db, "/ws")).toEqual([])
  })
})

describe("Session.permission — data blob round-trip (şema değişikliği yok)", () => {
  it("session.permission yazılıp geri okunur", async () => {
    const perm: PermissionRule[] = [{ permission: "bash", pattern: "*", action: "deny" }]
    const s: Session = {
      id: "s1",
      title: "s1",
      updatedAt: 0,
      messages: [],
      provider: "openai" as Session["provider"],
      model: "gpt",
      permission: perm,
    }
    await upsertSessionRow(db, s)
    const back = await loadSessionScalar(db, "s1")
    expect(back?.permission).toEqual(perm)
  })
})
