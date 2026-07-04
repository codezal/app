import { describe, it, expect, beforeEach } from "vitest"
import type { ModelMessage } from "ai"
import {
  parseLearnResponse,
  buildLearnPrompt,
  renderLearnTranscript,
  usedExternalTools,
  shouldLearn,
  beginLearn,
  endLearn,
  resetLearnState,
} from "@/lib/memory-learn"

describe("parseLearnResponse", () => {
  it("düz JSON array ayrıştırır", () => {
    const r = parseLearnResponse('[{"text":"use tabs","scope":"global"}]')
    expect(r).toEqual([{ text: "use tabs", scope: "global", category: undefined }])
  })
  it("```json fence'i sıyırır", () => {
    const r = parseLearnResponse('```json\n[{"text":"x","scope":"project"}]\n```')
    expect(r).toHaveLength(1)
    expect(r[0].scope).toBe("project")
  })
  it("baş/son prose'u atlar, gömülü diziyi yakalar", () => {
    const r = parseLearnResponse('Sure! [{"text":"y","scope":"project"}] done')
    expect(r).toHaveLength(1)
  })
  it("geçersiz scope project'e düşer; boş text elenir", () => {
    const r = parseLearnResponse('[{"text":"a","scope":"weird"},{"text":"   ","scope":"global"}]')
    expect(r).toEqual([{ text: "a", scope: "project", category: undefined }])
  })
  it("category baştaki # ve newline'ı temizler", () => {
    const r = parseLearnResponse('[{"text":"a","scope":"project","category":"# Deploy\\nx"}]')
    expect(r[0].category).toBe("Deploy x")
  })
  it("bozuk JSON / boş → []", () => {
    expect(parseLearnResponse("not json")).toEqual([])
    expect(parseLearnResponse("")).toEqual([])
    expect(parseLearnResponse("[oops")).toEqual([])
  })
  it("boş dizi → []", () => {
    expect(parseLearnResponse("[]")).toEqual([])
  })
})

describe("buildLearnPrompt", () => {
  it("existingNotes verilince dedup bloğu ekler", () => {
    const { prompt } = buildLearnPrompt("u: hi", "- use tabs")
    expect(prompt).toContain("existing-notes")
    expect(prompt).toContain("use tabs")
    expect(prompt).toContain("u: hi")
  })
  it("existingNotes boşsa dedup bloğu yok", () => {
    const { prompt, system } = buildLearnPrompt("u: hi", "  ")
    expect(prompt).not.toContain("existing-notes")
    expect(system).toContain("DURABLE")
  })
})

describe("renderLearnTranscript", () => {
  it("string content'i role ile yazar", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "merhaba" },
      { role: "assistant", content: "selam" },
    ]
    expect(renderLearnTranscript(msgs)).toBe("user: merhaba\nassistant: selam")
  })
  it("tool part'larını etiketler, reasoning'i atlar", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "tool-call", toolName: "read_file" },
          { type: "reasoning", text: "gizli" },
        ],
      },
    ] as unknown as ModelMessage[]
    const out = renderLearnTranscript(msgs)
    expect(out).toContain("[tool:read_file]")
    expect(out).toContain("ok")
    expect(out).not.toContain("gizli")
  })
  it("boş content satır üretmez", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "   " }]
    expect(renderLearnTranscript(msgs)).toBe("")
  })
})

describe("usedExternalTools", () => {
  it("mcp__ tool-call → true", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolName: "mcp__github__search" }] },
    ] as unknown as ModelMessage[]
    expect(usedExternalTools(msgs)).toBe(true)
  })
  it("web_search → true", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolName: "web_search" }] },
    ] as unknown as ModelMessage[]
    expect(usedExternalTools(msgs)).toBe(true)
  })
  it("yalnız built-in araç → false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolName: "read_file" },
          { type: "tool-call", toolName: "bash" },
        ],
      },
    ] as unknown as ModelMessage[]
    expect(usedExternalTools(msgs)).toBe(false)
  })
})

describe("throttle (shouldLearn / beginLearn / endLearn)", () => {
  beforeEach(() => resetLearnState())

  it("ilk kez true", () => {
    expect(shouldLearn("s1", 10, 1000)).toBe(true)
  })
  it("in-flight iken false", () => {
    beginLearn("s1", 10, 1000)
    expect(shouldLearn("s1", 20, 999_999)).toBe(false)
  })
  it("delta veya süre yetmezse false, ikisi de yeterse true", () => {
    beginLearn("s1", 10, 1000)
    endLearn("s1")
    expect(shouldLearn("s1", 12, 1000 + 60_001)).toBe(false) // delta 2 < 4
    expect(shouldLearn("s1", 20, 1000 + 100)).toBe(false)
    expect(shouldLearn("s1", 20, 1000 + 60_001)).toBe(true) // ikisi de yeter
  })
  it("resetLearnState(sid) tek session'ı temizler", () => {
    beginLearn("s1", 10, 1000)
    resetLearnState("s1")
    expect(shouldLearn("s1", 10, 1000)).toBe(true)
  })
})
