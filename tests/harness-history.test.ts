import { describe, it, expect } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { parseClaudeJsonl } from "@/lib/harness-history/readers/claude-code"
import { parseCodexRollout, extractCodexMessage } from "@/lib/harness-history/readers/codex"
import {
  parseOpencodeSession,
  buildOpencodeThreadFromRows,
} from "@/lib/harness-history/readers/opencode"
import { parseCursorComposer } from "@/lib/harness-history/readers/cursor"
import { extractText, deriveTitle, baseName } from "@/lib/harness-history/normalize"
import { harnessRoots, normalizeOS } from "@/lib/harness-history/paths"
import {
  ensureHistorySchema,
  upsertThread,
  searchThreads,
  hybridSearch,
  semanticRank,
  upsertThreadVector,
  threadEmbedText,
  listThreads,
  getThreadMessages,
  getIndexedMtimes,
  pruneMissing,
  buildFtsMatch,
} from "@/lib/harness-history/store"
import type { HarnessThread } from "@/lib/harness-history/types"

const NOW = 1_700_000_000_000

// ---- normalize ----
describe("normalize", () => {
  it("extractText düz string / blok dizisi / nested", () => {
    expect(extractText("hi")).toBe("hi")
    expect(extractText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb")
    expect(extractText([{ type: "input_text", text: "x" }, { type: "image", url: "..." }])).toBe("x")
    expect(extractText({ content: [{ type: "output_text", text: "z" }] })).toBe("z")
    expect(extractText(null)).toBe("")
  })
  it("baseName cross-platform", () => {
    expect(baseName("/a/b/c.jsonl")).toBe("c.jsonl")
    expect(baseName("C:\\a\\b\\d.json")).toBe("d.json")
  })
  it("deriveTitle ilk kullanıcı mesajından", () => {
    expect(deriveTitle([{ role: "user", text: "  Build a parser\nwith tests" }])).toBe(
      "Build a parser with tests",
    )
  })
})

// ---- paths (cross-platform) ----
describe("paths", () => {
  it("normalizeOS", () => {
    expect(normalizeOS("macos")).toBe("macos")
    expect(normalizeOS("windows")).toBe("windows")
    expect(normalizeOS("linux")).toBe("linux")
    expect(normalizeOS("freebsd")).toBe("linux")
  })
  it("claude/codex kökleri (trailing slash normalize)", () => {
    expect(harnessRoots("claude-code", "/Users/me/", "macos")).toEqual([
      "/Users/me/.claude/projects",
    ])
    expect(harnessRoots("codex", "/Users/me", "macos")).toEqual([
      "/Users/me/.codex/sessions",
      "/Users/me/.codex/archived_sessions",
    ])
  })
  it("opencode XDG (mac/linux) + Windows LOCALAPPDATA", () => {
    expect(harnessRoots("opencode", "/Users/me", "macos")).toEqual([
      "/Users/me/.local/share/opencode",
    ])
    expect(
      harnessRoots("opencode", "C:\\Users\\me", "windows", {
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      }),
    ).toEqual(["C:\\Users\\me\\AppData\\Local\\opencode"])
  })
  it("cursor per-OS kökleri", () => {
    expect(harnessRoots("cursor", "/Users/me", "macos")).toEqual([
      "/Users/me/Library/Application Support/Cursor/User",
    ])
    expect(harnessRoots("cursor", "/home/me", "linux")).toEqual(["/home/me/.config/Cursor/User"])
  })
})

// ---- Claude Code parser ----
describe("parseClaudeJsonl", () => {
  const jsonl = [
    { type: "attachment", message: {}, sessionId: "abc" },
    {
      type: "user",
      message: { role: "user", content: "How do I add OAuth refresh retry?" },
      timestamp: "2026-06-18T13:56:23.172Z",
      sessionId: "abc",
      cwd: "/home/u/proj",
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Use a backoff loop." }] },
      timestamp: "2026-06-18T13:56:25.000Z",
      sessionId: "abc",
    },
    { type: "user", isSidechain: true, message: { role: "user", content: "noise" } },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n")

  it("yalnız gerçek user/assistant; meta/sidechain atlanır", () => {
    const th = parseClaudeJsonl(jsonl, "/x/abc.jsonl")
    expect(th).not.toBeNull()
    expect(th!.id).toBe("claude-code:abc")
    expect(th!.nativeId).toBe("abc")
    expect(th!.projectPath).toBe("/home/u/proj")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages[1].text).toBe("Use a backoff loop.")
    expect(th!.title).toContain("OAuth refresh")
    expect(th!.startedAt).toBeLessThan(th!.updatedAt!)
  })
  it("konuşma yoksa null", () => {
    expect(parseClaudeJsonl(`{"type":"attachment"}\n`, "/x/e.jsonl")).toBeNull()
  })
  it("tool_result taşıyan user turn'ü atlanır (araç echo'su, gerçek mesaj değil)", () => {
    const jsonl = [
      { type: "user", message: { role: "user", content: "real question" }, timestamp: "2026-06-18T13:56:23.172Z", sessionId: "t1" },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "tool output noise" }] }] }, timestamp: "2026-06-18T13:56:24.000Z", sessionId: "t1" },
      { type: "assistant", message: { role: "assistant", content: "answer" }, timestamp: "2026-06-18T13:56:25.000Z", sessionId: "t1" },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n")
    const th = parseClaudeJsonl(jsonl, "/x/t1.jsonl")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(th!.messages.some((m) => m.text.includes("tool output noise"))).toBe(false)
  })
})

// ---- Codex parser ----
describe("parseCodexRollout", () => {
  it("session_meta + response_item (payload stringified, çift parse)", () => {
    const lines = [
      { timestamp: "2026-06-18T20:03:26.243Z", type: "session_meta", payload: JSON.stringify({ id: "cx1", cwd: "/home/u/cx" }) },
      { timestamp: "2026-06-18T20:03:27.000Z", type: "response_item", payload: JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "build a parser" }] }) },
      { timestamp: "2026-06-18T20:03:28.000Z", type: "response_item", payload: JSON.stringify({ type: "message", role: "assistant", content: [{ type: "output_text", text: "here is the code" }] }) },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n")
    const th = parseCodexRollout(lines, "/x/rollout-x.jsonl")
    expect(th!.id).toBe("codex:cx1")
    expect(th!.projectPath).toBe("/home/u/cx")
    expect(th!.messages).toHaveLength(2)
    expect(th!.title).toBe("build a parser")
  })
  it("response_item yoksa event_msg fallback", () => {
    const lines = [
      { timestamp: "2026-06-18T20:00:00.000Z", type: "session_meta", payload: JSON.stringify({ id: "cx2" }) },
      { timestamp: "2026-06-18T20:00:01.000Z", type: "event_msg", payload: JSON.stringify({ type: "user_message", message: "hello codex" }) },
      { timestamp: "2026-06-18T20:00:02.000Z", type: "event_msg", payload: JSON.stringify({ type: "agent_message", message: "hi back" }) },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n")
    const th = parseCodexRollout(lines, "/x/rollout-y.jsonl")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages[0].role).toBe("user")
    expect(th!.messages[1].role).toBe("assistant")
  })
  it("extractCodexMessage araç/bilinmeyen satırı eler", () => {
    expect(extractCodexMessage({ type: "function_call", name: "bash" })).toBeNull()
    expect(extractCodexMessage({ type: "message", role: "user", content: [] })).toBeNull()
  })
})

// ---- opencode parser ----
describe("parseOpencodeSession", () => {
  it("info + ham mesajlar; text-olmayan part atlanır", () => {
    const info = { id: "oc1", title: "My session", time: { created: 1000, updated: 2000 }, directory: "/home/u/oc" }
    const rawMsgs = [
      { role: "user", time: { created: 1000 }, parts: [{ type: "text", text: "hello opencode" }, { type: "tool", name: "bash" }] },
      { role: "assistant", time: { created: 1500 }, parts: [{ type: "text", text: "hi there" }] },
    ]
    const th = parseOpencodeSession(info, rawMsgs, "/p/info/oc1.json")
    expect(th!.id).toBe("opencode:oc1")
    expect(th!.title).toBe("My session")
    expect(th!.projectPath).toBe("/home/u/oc")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages[0].text).toBe("hello opencode")
  })
  it("metin yoksa null", () => {
    expect(parseOpencodeSession({ id: "x" }, [{ role: "user", parts: [{ type: "tool" }] }], "/p")).toBeNull()
  })

  it("buildOpencodeThreadFromRows — SQLite satırları → thread (part'lar message'a gruplanır, reasoning atlanır)", () => {
    const session = {
      id: "ses_1",
      title: "Selamlaşma",
      directory: "/home/u/g",
      time_created: 1000,
      time_updated: 2000,
    }
    const messageRows = [
      { id: "msg_1", time_created: 1000, data: JSON.stringify({ role: "user" }) },
      { id: "msg_2", time_created: 1500, data: JSON.stringify({ role: "assistant" }) },
    ]
    const partRows = [
      { message_id: "msg_1", data: JSON.stringify({ type: "text", text: "Merhaba" }) },
      { message_id: "msg_2", data: JSON.stringify({ type: "reasoning", text: "düşünce" }) },
      { message_id: "msg_2", data: JSON.stringify({ type: "text", text: "Selam!" }) },
    ]
    const th = buildOpencodeThreadFromRows(session, messageRows, partRows, "/d/opencode.db")
    expect(th).not.toBeNull()
    expect(th!.id).toBe("opencode:ses_1")
    expect(th!.title).toBe("Selamlaşma")
    expect(th!.projectPath).toBe("/home/u/g")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages[0]).toMatchObject({ role: "user", text: "Merhaba" })
    expect(th!.messages[1]).toMatchObject({ role: "assistant", text: "Selam!" })
    expect(th!.sourceRef).toBe("/d/opencode.db")
  })
})

// ---- Cursor parser ----
describe("parseCursorComposer", () => {
  it("bubble type 1/2 → user/assistant, header sırasıyla", () => {
    const composer = {
      composerId: "c1",
      name: "My chat",
      createdAt: 1000,
      lastUpdatedAt: 2000,
      fullConversationHeadersOnly: [
        { bubbleId: "b1", type: 1 },
        { bubbleId: "b2", type: 2 },
      ],
    }
    const bubbles = new Map<string, Record<string, unknown>>([
      ["b1", { bubbleId: "b1", type: 1, text: "hello cursor" }],
      ["b2", { bubbleId: "b2", type: 2, text: "hi from AI" }],
    ])
    const th = parseCursorComposer(composer, bubbles, "/p/state.vscdb", "/home/u/cp")
    expect(th!.id).toBe("cursor:c1")
    expect(th!.title).toBe("My chat")
    expect(th!.projectPath).toBe("/home/u/cp")
    expect(th!.messages).toHaveLength(2)
    expect(th!.messages[0]).toMatchObject({ role: "user", text: "hello cursor" })
    expect(th!.messages[1]).toMatchObject({ role: "assistant", text: "hi from AI" })
  })
  it("inline conversation (eski sürüm) desteklenir", () => {
    const composer = {
      composerId: "c2",
      conversation: [
        { type: 1, text: "soru" },
        { type: 2, text: "cevap" },
      ],
    }
    const th = parseCursorComposer(composer, new Map(), "/p", undefined)
    expect(th!.messages).toHaveLength(2)
    expect(th!.title).toBe("soru")
  })
  it("composerId yok / boş → null", () => {
    expect(parseCursorComposer({}, new Map(), "/p", undefined)).toBeNull()
    expect(parseCursorComposer({ composerId: "x" }, new Map(), "/p", undefined)).toBeNull()
  })
})

describe("store / search", () => {
  const claude = parseClaudeJsonl(
    [
      { type: "user", message: { role: "user", content: "How do I add OAuth refresh retry logic?" }, timestamp: "2026-06-18T13:56:23.172Z", sessionId: "abc", cwd: "/home/u/proj" },
      { type: "assistant", message: { role: "assistant", content: "Use a backoff loop with OAuth refresh." }, timestamp: "2026-06-18T13:56:25.000Z", sessionId: "abc" },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n"),
    "/x/abc.jsonl",
  ) as HarnessThread

  const codex = parseCodexRollout(
    [
      { timestamp: "2026-06-18T20:03:26.243Z", type: "session_meta", payload: JSON.stringify({ id: "cx1", cwd: "/home/u/cx" }) },
      { timestamp: "2026-06-18T20:03:27.000Z", type: "response_item", payload: JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "build a parser for the diff format" }] }) },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n"),
    "/x/rollout-x.jsonl",
  ) as HarnessThread

  async function seeded() {
    const db = nodeDb()
    await ensureHistorySchema(db)
    await upsertThread(db, claude, 111, NOW)
    await upsertThread(db, codex, 222, NOW + 1000)
    return db
  }

  it("buildFtsMatch token tırnak + OR; kısa/boş ele", () => {
    expect(buildFtsMatch("Hello World")).toBe('"hello" OR "world"')
    expect(buildFtsMatch("a")).toBe("")
    expect(buildFtsMatch("  ")).toBe("")
  })

  it("keyword arama eşleşen thread'i bulur", async () => {
    const db = await seeded()
    const hits = await searchThreads(db, "oauth refresh")
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].threadId).toBe("claude-code:abc")
    expect(hits[0].snippet).toContain("[")
    db.close()
  })

  it("harness filtresi", async () => {
    const db = await seeded()
    const hits = await searchThreads(db, "parser", { harness: "codex" })
    expect(hits.every((h) => h.harness === "codex")).toBe(true)
    expect(hits.length).toBe(1)
    db.close()
  })

  it("projectContains LIKE wildcard escape (injection değil)", async () => {
    const db = await seeded()
    expect(await searchThreads(db, "oauth", { projectContains: "proj" })).toHaveLength(1)
    expect(await searchThreads(db, "oauth", { projectContains: "pr_j" })).toHaveLength(0)
    db.close()
  })

  it("thread başına tek hit (çoklu mesaj eşleşse de dedupe)", async () => {
    const db = await seeded()
    const hits = await searchThreads(db, "oauth")
    expect(hits.filter((h) => h.threadId === "claude-code:abc")).toHaveLength(1)
    db.close()
  })

  it("re-upsert mesajları çoğaltmaz + mtime güncellenir", async () => {
    const db = await seeded()
    await upsertThread(db, claude, 333, NOW)
    expect(await getThreadMessages(db, "claude-code:abc")).toHaveLength(2)
    expect((await getIndexedMtimes(db)).get("claude-code:abc")).toBe(333)
    db.close()
  })

  it("listThreads updated_at DESC", async () => {
    const db = await seeded()
    const rows = await listThreads(db)
    expect(rows[0].threadId).toBe("codex:cx1") // daha yeni updated_at
    db.close()
  })

  it("pruneMissing yalnız taranan harness kapsamında siler", async () => {
    const db = await seeded()
    const removed = await pruneMissing(db, new Set<string>(), new Set(["codex"]))
    expect(removed).toBe(1)
    expect(await getThreadMessages(db, "claude-code:abc")).toHaveLength(2)
    expect(await getThreadMessages(db, "codex:cx1")).toHaveLength(0)
    db.close()
  })

  it("threadEmbedText — başlık + mesaj başı, 2000 char tavanı", () => {
    const txt = threadEmbedText(claude)
    expect(txt).toContain(claude.title)
    expect(txt.length).toBeLessThanOrEqual(2000)
  })

  it("semanticRank — cosine'e göre sıralı", async () => {
    const db = await seeded()
    await upsertThreadVector(db, "claude-code:abc", [1, 0, 0])
    await upsertThreadVector(db, "codex:cx1", [0, 1, 0])
    const ranked = await semanticRank(db, [1, 0, 0])
    expect(ranked[0].threadId).toBe("claude-code:abc")
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    db.close()
  })

  it("hybridSearch — keyword + semantik RRF ile birleşir", async () => {
    const db = await seeded()
    await upsertThreadVector(db, "claude-code:abc", [1, 0, 0])
    await upsertThreadVector(db, "codex:cx1", [0, 1, 0])
    const hits = await hybridSearch(db, "oauth", [0, 1, 0], { limit: 10 })
    const ids = hits.map((h) => h.threadId)
    expect(ids).toContain("claude-code:abc")
    expect(ids).toContain("codex:cx1")
    db.close()
  })

  it("hybridSearch — queryVec null → keyword-only", async () => {
    const db = await seeded()
    const hits = await hybridSearch(db, "oauth", null, { limit: 10 })
    expect(hits.every((h) => h.threadId === "claude-code:abc")).toBe(true)
    db.close()
  })
})
