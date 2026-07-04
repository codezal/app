import { describe, it, expect } from "vitest"
import { estimateTextTokens, estimateMessagesTokens } from "@/lib/tokens"
import type { ModelMessage } from "ai"

describe("estimateTextTokens", () => {
  it("boş string → 0", () => {
    expect(estimateTextTokens("")).toBe(0)
  })

  it("tam bölünebilen uzunluk → length/4", () => {
    expect(estimateTextTokens("abcd")).toBe(1)
    expect(estimateTextTokens("abcdefgh")).toBe(2)
  })

  it("bölünemeyen → yukarı yuvarlanır", () => {
    expect(estimateTextTokens("abc")).toBe(1) // ceil(3/4)=1
    expect(estimateTextTokens("abcde")).toBe(2) // ceil(5/4)=2
  })

  it("uzun metin tutarlı", () => {
    const t = "a".repeat(1000)
    expect(estimateTextTokens(t)).toBe(250)
  })
})

describe("estimateMessagesTokens", () => {
  it("boş mesaj dizisi → 0", () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })

  it("sistem prompt eklenir", () => {
    const withSys = estimateMessagesTokens([], "hello")
    const without = estimateMessagesTokens([])
    expect(withSys).toBeGreaterThan(without)
  })

  it("string content mesaj", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "abcdefgh" }]
    const t = estimateMessagesTokens(msgs)
    expect(t).toBeGreaterThan(0)
  })

  it("parts array — text part sayılır", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "abcdefgh" }],
      },
    ]
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0)
  })

  it("tool-call part overhead ekler", () => {
    const withTool: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "bash",
            input: { command: "echo hi" },
          },
        ],
      },
    ]
    const plain: ModelMessage[] = [{ role: "assistant", content: "" }]
    expect(estimateMessagesTokens(withTool)).toBeGreaterThan(estimateMessagesTokens(plain))
  })

  it("tool-result part overhead ekler", () => {
    const withResult: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "1",
            output: "some output text",
          },
        ],
      },
    ]
    const plain: ModelMessage[] = [{ role: "assistant", content: "" }]
    expect(estimateMessagesTokens(withResult)).toBeGreaterThan(estimateMessagesTokens(plain))
  })

  it("çok mesaj birikimli artar", () => {
    const one: ModelMessage[] = [{ role: "user", content: "hello" }]
    const two: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]
    expect(estimateMessagesTokens(two)).toBeGreaterThan(estimateMessagesTokens(one))
  })
})
