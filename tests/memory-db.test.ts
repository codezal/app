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

  it("concurrent inserts to the same scope lose nothing (H11)", async () => {
    // Distinct texts (low jaccard) so consolidate does not merge them — this
    // isolates the concurrency race from intentional similarity-dedup.
    const facts = [
      "The deployment pipeline uses GitHub Actions",
      "Database schema lives in src/lib/db/schema.ts",
      "Tests run in node environment without a DOM",
      "The sidebar groups sessions by workspace folder",
      "Streaming is single-flight per session id",
      "Settings persist to localStorage with schemaVersion",
      "MCP servers may register stdio or http transports",
      "Plugin manifests must declare their permissions",
    ]
    await Promise.all(
      facts.map((text, i) =>
        insertMemoryEntry(db, {
          scope: "project",
          workspace: "/ws",
          text,
          source: "auto_learn",
          createdAt: 100 + i,
        }),
      ),
    )
    const after = await listMemoryEntries(db, { scope: "project", workspace: "/ws" })
    const texts = after.map((e) => e.text)
    for (const f of facts) {
      expect(texts).toContain(f)
    }
  })
})
