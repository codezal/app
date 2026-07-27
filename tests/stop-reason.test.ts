import { describe, it, expect } from "vitest"
import { detectStopReason, isUserWaitingTool } from "@/lib/stream/stop-reason"
import type { Part } from "@/store/types"

const text: Part = { type: "text", text: "ok" }
const reasoning: Part = { type: "reasoning", text: "r" }
const toolCall: Part = { type: "tool-call", toolCallId: "1", toolName: "grep", input: {} }
const toolResult: Part = { type: "tool-result", toolCallId: "1", toolName: "grep", output: "x" }
const questionCall: Part = { type: "tool-call", toolCallId: "2", toolName: "question", input: {} }
const proposeBuildResult: Part = {
  type: "tool-result",
  toolCallId: "3",
  toolName: "propose_build",
  output: "ok",
}
const proposePlanCall: Part = {
  type: "tool-call",
  toolCallId: "4",
  toolName: "propose_plan",
  input: {},
}
const bashCall: Part = { type: "tool-call", toolCallId: "5", toolName: "bash", input: {} }

describe("detectStopReason", () => {
  it("length finishReason → 'length' (son part text olsa bile)", () => {
    expect(detectStopReason("length", text)).toBe("length")
  })

  it("tool-result ile bittiyse → 'halted'", () => {
    expect(detectStopReason("stop", toolResult)).toBe("halted")
  })

  it("finishReason tool-calls + tool-result → step-cap kesintisi = 'halted'", () => {
    expect(detectStopReason("tool-calls", toolResult)).toBe("halted")
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

describe("detectStopReason — kullanıcıyı bekleyen araçlar", () => {
  it("question tool-call ile bitti → undefined (yarım değil, kullanıcıyı bekliyor)", () => {
    expect(detectStopReason(undefined, questionCall)).toBeUndefined()
    expect(detectStopReason("stop", questionCall)).toBeUndefined()
  })

  it("propose_build tool-result ile bitti → undefined", () => {
    expect(detectStopReason("stop", proposeBuildResult)).toBeUndefined()
  })

  it("propose_plan tool-call ile bitti → undefined", () => {
    expect(detectStopReason(undefined, proposePlanCall)).toBeUndefined()
  })

  it("regresyon: kullanıcı-beklemeyen tool (bash) hâlâ 'halted'", () => {
    expect(detectStopReason(undefined, bashCall)).toBe("halted")
    expect(detectStopReason("stop", bashCall)).toBe("halted")
  })

  it("length önceliği kullanıcı-bekleyen araçtan önce gelir", () => {
    expect(detectStopReason("length", questionCall)).toBe("length")
  })
})

describe("isUserWaitingTool", () => {
  it("bilinen kullanıcı-bekleyen araçlar → true", () => {
    expect(isUserWaitingTool("question")).toBe(true)
    expect(isUserWaitingTool("propose_plan")).toBe(true)
    expect(isUserWaitingTool("propose_build")).toBe(true)
  })

  it("diğer araçlar ve undefined → false", () => {
    expect(isUserWaitingTool("bash")).toBe(false)
    expect(isUserWaitingTool("grep")).toBe(false)
    expect(isUserWaitingTool(undefined)).toBe(false)
  })
})
