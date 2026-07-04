import { describe, it, expect } from "vitest"
import { detectStopReason } from "@/lib/stream/stop-reason"
import type { Part } from "@/store/types"

const text: Part = { type: "text", text: "ok" }
const reasoning: Part = { type: "reasoning", text: "r" }
const toolCall: Part = { type: "tool-call", toolCallId: "1", toolName: "grep", input: {} }
const toolResult: Part = { type: "tool-result", toolCallId: "1", toolName: "grep", output: "x" }

describe("detectStopReason", () => {
  it("length finishReason → 'length' (son part text olsa bile)", () => {
    expect(detectStopReason("length", text)).toBe("length")
  })

  it("tool-result ile bittiyse → 'halted'", () => {
    expect(detectStopReason("stop", toolResult)).toBe("halted")
  })

  it("finishReason tool-calls + tool-result → normal tool döngüsü", () => {
    expect(detectStopReason("tool-calls", toolResult)).toBeUndefined()
  })

  it("tool-call ile bittiyse → 'halted'", () => {
    expect(detectStopReason("stop", toolCall)).toBe("halted")
  })

  it("text ile bitti (normal tur) → undefined", () => {
    expect(detectStopReason("stop", text)).toBeUndefined()
  })

  it("reasoning ile bitti → undefined (tool değil)", () => {
    expect(detectStopReason("stop", reasoning)).toBeUndefined()
  })

  it("boş parts (lastPart undefined) → undefined", () => {
    expect(detectStopReason("stop", undefined)).toBeUndefined()
  })

  it("length, tool-result'tan önce gelir (öncelik)", () => {
    expect(detectStopReason("length", toolResult)).toBe("length")
  })

  it("finishReason undefined + tool-result → 'halted'", () => {
    expect(detectStopReason(undefined, toolResult)).toBe("halted")
  })
})
