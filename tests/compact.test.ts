// compact — shouldCompact + targetTokensAfterCompact + pruneToolOutputs pure logic.
import { describe, it, expect } from "vitest"
import type { ModelMessage } from "ai"
import { shouldCompact, targetTokensAfterCompact, pruneToolOutputs } from "@/lib/compact"
import type { AutoCompactSettings } from "@/store/types"

const cfg: AutoCompactSettings = {
  enabled: true,
  triggerPct: 90,
  targetPct: 40,
  keepLast: 10,
}

describe("shouldCompact", () => {
  it("enabled=false → her zaman false", () => {
    expect(shouldCompact(999999, "gpt-4o", { ...cfg, enabled: false })).toBe(false)
  })

  it("0 token → false", () => {
    expect(shouldCompact(0, "gpt-4o", cfg)).toBe(false)
  })

  it("trigger altında → false", () => {
    // 128K context cap, %90 = 115200. 50000 < 115200.
    expect(shouldCompact(50_000, "gpt-4o", cfg)).toBe(false)
  })

  it("trigger üstünde → true", () => {
    expect(shouldCompact(10_000_000, "gpt-4o", cfg)).toBe(true)
  })
})

describe("targetTokensAfterCompact", () => {
  it("targetPct uygulanır", () => {
    const t = targetTokensAfterCompact("gpt-4o", cfg)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(targetTokensAfterCompact("gpt-4o", { ...cfg, targetPct: 50 }))
  })
})

describe("shouldCompact reserved-output buffer", () => {
  // deepseek-chat cap = 128k; usable = 128k - 20k reserved = 108k.
  it("ham cap altında ama usable üstünde → true (tampon sayesinde erken tetik)", () => {
    const full: AutoCompactSettings = { ...cfg, triggerPct: 100 }
    expect(shouldCompact(110_000, "deepseek-chat", full)).toBe(true)
  })
  it("usable altında → false", () => {
    const full: AutoCompactSettings = { ...cfg, triggerPct: 100 }
    expect(shouldCompact(100_000, "deepseek-chat", full)).toBe(false)
  })
})

// ---- pruneToolOutputs ----
function userMsg(t: string): ModelMessage {
  return { role: "user", content: t }
}
function asstMsg(t: string): ModelMessage {
  return { role: "assistant", content: t }
}
function toolMsg(id: string, size: number): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: id, toolName: "read", output: { type: "text", value: "x".repeat(size) } }],
  } as ModelMessage
}
function outputValue(m: ModelMessage): string {
  const part = (m.content as Array<Record<string, unknown>>)[0]
  return ((part.output as Record<string, unknown>).value as string) ?? ""
}

describe("pruneToolOutputs", () => {
  it("son 2 turdan az → budama yok", () => {
    const msgs = [userMsg("u1"), asstMsg("a1"), toolMsg("t1", 300_000)]
    expect(pruneToolOutputs(msgs).prunedTokens).toBe(0)
  })

  it("eski büyük tool çıktısı budanır, yakın çıktı korunur", () => {
    const msgs = [
      userMsg("u1"),
      asstMsg("a1"),
      toolMsg("t1", 300_000),
      userMsg("u2"),
      asstMsg("a2"),
      toolMsg("t2", 10_000),
      userMsg("u3"),
      asstMsg("a3"),
    ]
    const { messages: out, prunedTokens } = pruneToolOutputs(msgs)
    expect(prunedTokens).toBeGreaterThan(0)
    expect(outputValue(out[2]!)).toContain("removed to save context")
    expect(outputValue(out[5]!)).toBe("x".repeat(10_000))
  })

  it("idempotent — budanmış geçmiş ikinci kez budanmaz", () => {
    const msgs = [
      userMsg("u1"),
      asstMsg("a1"),
      toolMsg("t1", 300_000),
      userMsg("u2"),
      asstMsg("a2"),
      userMsg("u3"),
    ]
    const { messages: out } = pruneToolOutputs(msgs)
    expect(pruneToolOutputs(out).prunedTokens).toBe(0)
  })

  it("küçük çıktılar koruma bütçesinde → budama yok", () => {
    const msgs = [
      userMsg("u1"),
      toolMsg("t1", 4_000),
      userMsg("u2"),
      asstMsg("a2"),
      userMsg("u3"),
    ]
    expect(pruneToolOutputs(msgs).prunedTokens).toBe(0)
  })
})

// ---- pruneToolOutputs opts (overflow recovery / intra-turn guard) ----
function multiToolMsg(specs: Array<{ id: string; size: number }>): ModelMessage {
  return {
    role: "tool",
    content: specs.map((s) => ({
      type: "tool-result",
      toolCallId: s.id,
      toolName: "read",
      output: { type: "text", value: "x".repeat(s.size) },
    })),
  } as ModelMessage
}
function partValue(m: ModelMessage, j: number): string {
  const part = (m.content as Array<Record<string, unknown>>)[j]
  return ((part.output as Record<string, unknown>).value as string) ?? ""
}

describe("pruneToolOutputs — opts (recovery/guard)", () => {
  it("tailTurns:0 → en yakın turun tool çıktısı da budanabilir", () => {
    const msgs = [userMsg("u1"), asstMsg("a1"), toolMsg("t1", 300_000)]
    expect(pruneToolOutputs(msgs).prunedTokens).toBe(0)
    const { prunedTokens } = pruneToolOutputs(msgs, {
      tailTurns: 0,
      protectTokens: 40_000,
      minGain: 1,
    })
    expect(prunedTokens).toBeGreaterThan(0)
  })

  it("tek mesajda 16 paralel okuma → part part budanır, yakınlar korunur", () => {
    const reads = Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, size: 50_000 }))
    const msgs = [userMsg("align i18n"), asstMsg("okuyorum"), multiToolMsg(reads)]
    const { messages: out, prunedTokens } = pruneToolOutputs(msgs, {
      tailTurns: 0,
      protectTokens: 40_000,
      minGain: 1,
    })
    expect(prunedTokens).toBeGreaterThan(0)
    const toolOut = out[2]!
    expect(partValue(toolOut, 0)).toContain("removed to save context")
    expect(partValue(toolOut, 15)).toBe("x".repeat(50_000)) // son part korundu
  })

  it("minGain:1 → küçük kazanç bile uygulanır (recovery garantisi)", () => {
    const msgs = [
      userMsg("u1"),
      toolMsg("t1", 120_000),
      userMsg("u2"),
      toolMsg("t2", 120_000),
    ]
    const { prunedTokens } = pruneToolOutputs(msgs, {
      tailTurns: 0,
      protectTokens: 40_000,
      minGain: 1,
    })
    expect(prunedTokens).toBeGreaterThan(0)
  })
})
