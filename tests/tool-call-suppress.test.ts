import { describe, it, expect } from "vitest"
import { stripSuppressedToolMessages } from "@/lib/stream/run-stream"
import type { ModelMessage } from "ai"

describe("stripSuppressedToolMessages", () => {
  it("boş id seti → aynı referansı döner", () => {
    const msgs: ModelMessage[] = [{ role: "assistant", content: "selam" }]
    expect(stripSuppressedToolMessages(msgs, new Set())).toBe(msgs)
  })

  it("bastırılmış tool-call + tool-result'ı siler, gerçeği korur", () => {
    const msgs = [
      { role: "user", content: "analiz et" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "bakıyorum" },
          { type: "tool-call", toolCallId: "bad", toolName: '{"name":"x"}', input: {} },
          { type: "tool-call", toolCallId: "good", toolName: "read_file", input: {} },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "bad", toolName: "x", output: { type: "text", value: "err" } }],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "good", toolName: "read_file", output: { type: "text", value: "ok" } },
        ],
      },
    ] as unknown as ModelMessage[]

    const out = stripSuppressedToolMessages(msgs, new Set(["bad"]))
    const asst = out[1] as unknown as { content: Array<{ type: string; toolCallId?: string }> }
    expect(asst.content.map((p) => p.toolCallId ?? p.type)).toEqual(["text", "good"])
    expect(out.filter((m) => m.role === "tool")).toHaveLength(1)
    expect(out.filter((m) => m.role === "user")).toHaveLength(1)
  })

  it("içeriği tamamen bastırılan mesajı atar", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "bad", toolName: "{}", input: {} }] },
    ] as unknown as ModelMessage[]
    expect(stripSuppressedToolMessages(msgs, new Set(["bad"]))).toHaveLength(0)
  })

  it("eşleşmeyen id → mesajlar değişmez", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "good", toolName: "read_file", input: {} }] },
    ] as unknown as ModelMessage[]
    const out = stripSuppressedToolMessages(msgs, new Set(["bad"]))
    expect(out).toHaveLength(1)
  })
})
