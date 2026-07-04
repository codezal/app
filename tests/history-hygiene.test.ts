import { describe, it, expect } from "vitest"
import type { ModelMessage } from "ai"
import { applyHistoryHygiene } from "@/lib/token-savers/history-hygiene"

function userMsg(t: string): ModelMessage {
  return { role: "user", content: t }
}
function toolMsg(id: string, value: string): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: id, toolName: "bash", output: { type: "text", value } }],
  } as ModelMessage
}
function outVal(m: ModelMessage): string {
  const part = (m.content as Array<Record<string, unknown>>)[0]!
  return (part.output as { value: string }).value
}

const OPTS = { maxLines: 20, maxBytes: 4096 }

describe("applyHistoryHygiene", () => {
  it("eski uzun tool çıktısı satır tavanına kırpılır + marker", () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
    const msgs: ModelMessage[] = [
      userMsg("ilk soru"),
      toolMsg("a", big),
      userMsg("ikinci soru"), // son tur — korunur
      toolMsg("b", "kısa çıktı"),
    ]
    const { messages, saved } = applyHistoryHygiene(msgs, OPTS)
    const trimmed = outVal(messages[1]!)
    expect(trimmed).toMatch(/satır kırpıldı/)
    expect(trimmed.split("\n").length).toBeLessThan(big.split("\n").length)
    expect(saved).toBeGreaterThan(0)
  })

  it("son user turu korunur (dokunulmaz)", () => {
    const big = Array.from({ length: 200 }, (_, i) => `x ${i}`).join("\n")
    const msgs: ModelMessage[] = [
      userMsg("ilk"),
      toolMsg("a", "eski kısa"),
      userMsg("güncel"),
      toolMsg("b", big),
    ]
    const { messages } = applyHistoryHygiene(msgs, OPTS)
    expect(outVal(messages[3]!)).toBe(big)
  })

  it("tavan altındaki çıktı değişmez (referans korunur)", () => {
    const msgs: ModelMessage[] = [
      userMsg("ilk"),
      toolMsg("a", "tek satır"),
      userMsg("güncel"),
    ]
    const { messages, saved } = applyHistoryHygiene(msgs, OPTS)
    expect(messages).toBe(msgs)
    expect(saved).toBe(0)
  })

  it("idempotent — ikinci geçiş ek kırpma yapmaz", () => {
    const big = Array.from({ length: 500 }, (_, i) => `row ${i}`).join("\n")
    const msgs: ModelMessage[] = [userMsg("ilk"), toolMsg("a", big), userMsg("güncel")]
    const first = applyHistoryHygiene(msgs, OPTS)
    const second = applyHistoryHygiene(first.messages, OPTS)
    expect(second.saved).toBe(0)
    expect(second.messages).toBe(first.messages)
  })

  it("byte tavanı uzun tek satırı da kırpar", () => {
    const oneBigLine = "z".repeat(50_000)
    const msgs: ModelMessage[] = [userMsg("ilk"), toolMsg("a", oneBigLine), userMsg("güncel")]
    const { messages, saved } = applyHistoryHygiene(msgs, OPTS)
    expect(outVal(messages[1]!)).toMatch(/byte kırpıldı/)
    expect(saved).toBeGreaterThan(0)
  })

  it("çok-baytlı (Türkçe) çıktıda byte tavanı aşılmaz + karakter bölünmez", () => {
    const big = "şğüöçı".repeat(5000)
    const msgs: ModelMessage[] = [userMsg("ilk"), toolMsg("a", big), userMsg("güncel")]
    const { messages } = applyHistoryHygiene(msgs, OPTS)
    const out = outVal(messages[1]!)
    const bytes = new TextEncoder().encode(out).length
    expect(bytes).toBeLessThanOrEqual(OPTS.maxBytes)
    expect(out).toMatch(/byte kırpıldı/)
    expect(out).not.toContain("�")
  })

  it("çok-baytlı çıktıda da idempotent", () => {
    const big = "ığşçöü".repeat(5000)
    const msgs: ModelMessage[] = [userMsg("ilk"), toolMsg("a", big), userMsg("güncel")]
    const first = applyHistoryHygiene(msgs, OPTS)
    const second = applyHistoryHygiene(first.messages, OPTS)
    expect(second.saved).toBe(0)
    expect(second.messages).toBe(first.messages)
  })

  it("user mesajı yoksa no-op", () => {
    const msgs: ModelMessage[] = [toolMsg("a", "x".repeat(100_000))]
    const { messages, saved } = applyHistoryHygiene(msgs, OPTS)
    expect(messages).toBe(msgs)
    expect(saved).toBe(0)
  })
})
