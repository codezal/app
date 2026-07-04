import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ModelMessage } from "ai"
import type { AutoCompactSettings, Settings } from "@/store/types"

const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateText: generateTextMock,
}))
vi.mock("@/lib/providers", async (orig) => ({
  ...(await orig<typeof import("@/lib/providers")>()),
  buildLanguageModel: vi.fn(async () => ({}) as never),
}))

import { compactMessages } from "@/lib/compact"

const SETTINGS = (over: Partial<AutoCompactSettings> = {}): AutoCompactSettings => ({
  enabled: true,
  triggerPct: 75,
  targetPct: 50,
  keepLast: 3,
  model: "openai/cheap",
  ...over,
})
const appSettings = { providerCatalog: { data: undefined } } as unknown as Settings

function twoTurns(): ModelMessage[] {
  return [
    { role: "user", content: "u1" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: "r1" } }] },
    { role: "assistant", content: "a1 done" },
    { role: "user", content: "u2" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c2", toolName: "read", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "read", output: { type: "text", value: "r2" } }] },
    { role: "assistant", content: "a2 done" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3 done" },
  ]
}

function ids(msgs: ModelMessage[]): { calls: Set<string>; results: Set<string> } {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue
    for (const p of m.content as Array<Record<string, unknown>>) {
      if (p.type === "tool-call") calls.add(String(p.toolCallId))
      if (p.type === "tool-result") results.add(String(p.toolCallId))
    }
  }
  return { calls, results }
}

describe("compactMessages cutoff", () => {
  beforeEach(() => {
    generateTextMock.mockReset()
    generateTextMock.mockResolvedValue({ text: "MEMORY", usage: { inputTokens: 1, outputTokens: 1 } })
  })

  it("kesim user-boundary'ye hizalanır: keepPart user ile başlar, tool-call/result çiftleri bütün", async () => {
    const out = await compactMessages({
      messages: twoTurns(),
      appSettings,
      activeProvider: "openai",
      activeModel: "gpt",
      settings: SETTINGS({ keepLast: 3 }),
    })
    // [0] = compacted-memory system
    expect(out.messages[0]!.role).toBe("system")
    expect(typeof out.messages[0]!.content === "string" && out.messages[0]!.content.includes("<compacted-memory>")).toBe(true)
    expect(out.messages[1]!.role).toBe("user")
    const { calls, results } = ids(out.messages)
    for (const r of results) expect(calls.has(r)).toBe(true)
    expect(calls.has("c2")).toBe(true)
    expect(results.has("c1")).toBe(false)
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it("body <= keepLast → no-op (LLM çağrısı yok, orijinal döner)", async () => {
    const msgs = twoTurns().slice(0, 2) // 2 mesaj, keepLast=3
    const out = await compactMessages({
      messages: msgs,
      appSettings,
      activeProvider: "openai",
      activeModel: "gpt",
      settings: SETTINGS({ keepLast: 3 }),
    })
    expect(out.messages).toBe(msgs)
    expect(out.memoryText).toBe("")
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
