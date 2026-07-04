import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema } from "@/lib/db/schema"
import {
  archiveMemoryEntriesByText,
  insertMemoryEntry,
  listMemoryEntries,
  loadMemoryContextBlockFromDb,
} from "@/lib/db/memory-db"

let db: ReturnType<typeof nodeDb>

beforeEach(async () => {
  db = nodeDb()
  await applySchema(db)
})

afterEach(() => {
  db.close()
})

describe("memory_entry schema", () => {
  it("insert + list project/global learned memory", async () => {
    await insertMemoryEntry(db, {
      scope: "project",
      workspace: "/ws",
      text: "Use Vitest for unit tests",
      category: "Testing",
      source: "manual",
      createdAt: 100,
    })
    await insertMemoryEntry(db, {
      scope: "global",
      text: "Reply in Turkish",
      layer: "identity",
      source: "remember_tool",
      createdAt: 90,
    })

    const project = await listMemoryEntries(db, { scope: "project", workspace: "/ws" })
    const global = await listMemoryEntries(db, { scope: "global" })
    expect(project.map((e) => e.text)).toEqual(["Use Vitest for unit tests"])
    expect(project[0].category).toBe("Testing")
    expect(global.map((e) => e.text)).toEqual(["Reply in Turkish"])
    expect(global[0].layer).toBe("identity")
  })

  it("loads project + global context, then hides archived entries", async () => {
    await insertMemoryEntry(db, {
      scope: "project",
      workspace: "/ws",
      text: "The project uses Tauri",
      createdAt: 100,
    })
    await insertMemoryEntry(db, {
      scope: "global",
      text: "Prefer short Turkish replies",
      layer: "identity",
      createdAt: 100,
    })

    const before = await loadMemoryContextBlockFromDb(db, {
      workspace: "/ws",
      query: "Tauri project",
      now: 200,
      budgetTokens: 200,
    })
    expect(before).toContain("Learned Memory")
    expect(before).toContain("The project uses Tauri")
    expect(before).toContain("Prefer short Turkish replies")

    await archiveMemoryEntriesByText(db, {
      scope: "project",
      workspace: "/ws",
      text: "The project uses Tauri",
    })
    const after = await loadMemoryContextBlockFromDb(db, {
      workspace: "/ws",
      query: "Tauri project",
      now: 300,
      budgetTokens: 200,
    })
    expect(after).not.toContain("The project uses Tauri")
    expect(after).toContain("Prefer short Turkish replies")
  })

  it("keeps project scopes isolated by workspace path", async () => {
    await insertMemoryEntry(db, { scope: "project", workspace: "/a", text: "A fact" })
    await insertMemoryEntry(db, { scope: "project", workspace: "/b", text: "B fact" })
    expect((await listMemoryEntries(db, { scope: "project", workspace: "/a" })).map((e) => e.text)).toEqual([
      "A fact",
    ])
    expect((await listMemoryEntries(db, { scope: "project", workspace: "/b" })).map((e) => e.text)).toEqual([
      "B fact",
    ])
  })
})
