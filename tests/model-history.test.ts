// model-history — rebuild AI SDK model history from persisted UI messages.
// Guards the restart path: Session.modelMessages is RAM-only, so after an app
// restart the history is rebuilt from messages+parts. Tool calls/results must
// survive, or the model loses the files/commands from earlier turns.
import { describe, expect, it } from "vitest"
import type { Message } from "@/store/types"
import { messagesToModelMessages } from "@/lib/model-history"

function msg(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return { ...partial }
}

describe("messagesToModelMessages", () => {
  it("plain user/assistant text survives (legacy part-less messages)", () => {
    const out = messagesToModelMessages([
      msg({ id: "u1", role: "user", content: "merhaba" }),
      msg({ id: "a1", role: "assistant", content: "selam" }),
    ])
    expect(out).toEqual([
      { role: "user", content: "merhaba" },
      { role: "assistant", content: "selam" },
    ])
  })

  it("rebuilds tool calls and tool results from parts", () => {
    const out = messagesToModelMessages([
      msg({ id: "u1", role: "user", content: "oku" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "dosyayı okudum",
        parts: [
          { type: "tool-call", toolCallId: "t1", toolName: "read_file", input: { path: "a.ts" } },
          { type: "tool-result", toolCallId: "t1", toolName: "read_file", output: "FILE BODY" },
          { type: "text", text: "dosyayı okudum" },
        ],
      }),
    ])
    // 1 user + 3 for the assistant turn (assistant w/ tool-call, tool result,
    // final assistant text) — matches modelMsgCount used by truncateAfter.
    expect(out).toHaveLength(4)
    expect(out[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "t1", toolName: "read_file" }],
    })
    expect(out[2]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          output: { type: "text", value: "FILE BODY" },
        },
      ],
    })
    expect(out[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "dosyayı okudum" }] })
  })

  it("marks errored tool results as error-text", () => {
    const out = messagesToModelMessages([
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        parts: [
          { type: "tool-call", toolCallId: "t1", toolName: "bash", input: {} },
          { type: "tool-result", toolCallId: "t1", toolName: "bash", output: "boom", isError: true },
        ],
      }),
    ])
    expect(out[1]).toMatchObject({
      role: "tool",
      content: [{ output: { type: "error-text", value: "boom" } }],
    })
  })

  it("keeps reasoning parts in the assistant run", () => {
    const out = messagesToModelMessages([
      msg({
        id: "a1",
        role: "assistant",
        content: "cevap",
        parts: [
          { type: "reasoning", text: "düşünüyorum" },
          { type: "text", text: "cevap" },
        ],
      }),
    ])
    expect(out).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "düşünüyorum" },
          { type: "text", text: "cevap" },
        ],
      },
    ])
  })

  it("skips pending and empty messages", () => {
    const out = messagesToModelMessages([
      msg({ id: "u1", role: "user", content: "x" }),
      msg({ id: "a1", role: "assistant", content: "", pending: true }),
      msg({ id: "u2", role: "user", content: "   " }),
    ])
    expect(out).toEqual([{ role: "user", content: "x" }])
  })

  it("drops system/status UI rows (compaction notices)", () => {
    const out = messagesToModelMessages([
      msg({ id: "s1", role: "system", content: "✓ Sıkıştırıldı" }),
      msg({ id: "u1", role: "user", content: "devam" }),
    ])
    expect(out).toEqual([{ role: "user", content: "devam" }])
  })

  it("attaches stored images to the user message", () => {
    const out = messagesToModelMessages([
      msg({
        id: "u1",
        role: "user",
        content: "buna bak",
        images: [{ id: "i1", dataUrl: "data:image/png;base64,AAA", mime: "image/png" }],
      }),
    ])
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "buna bak" },
          { type: "image", image: "data:image/png;base64,AAA", mediaType: "image/png" },
        ],
      },
    ])
  })

  it("falls back to content when parts carry nothing model-visible", () => {
    const out = messagesToModelMessages([
      msg({
        id: "a1",
        role: "assistant",
        content: "özet metin",
        parts: [{ type: "text", text: "   " }],
      }),
    ])
    expect(out).toEqual([{ role: "assistant", content: "özet metin" }])
  })

  it("multiple tool rounds keep chronological order", () => {
    const out = messagesToModelMessages([
      msg({
        id: "a1",
        role: "assistant",
        content: "bitti",
        parts: [
          { type: "text", text: "önce bakayım" },
          { type: "tool-call", toolCallId: "t1", toolName: "read_file", input: {} },
          { type: "tool-result", toolCallId: "t1", toolName: "read_file", output: "A" },
          { type: "tool-call", toolCallId: "t2", toolName: "grep", input: {} },
          { type: "tool-result", toolCallId: "t2", toolName: "grep", output: "B" },
          { type: "text", text: "bitti" },
        ],
      }),
    ])
    expect(out.map((m) => m.role)).toEqual(["assistant", "tool", "assistant", "tool", "assistant"])
  })
})
