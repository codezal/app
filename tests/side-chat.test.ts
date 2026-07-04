import { describe, it, expect } from "vitest"
import type { ModelMessage } from "ai"
import {
  SIDE_CHAT_SYSTEM,
  newSideChatThread,
  buildSideChatMessages,
} from "@/lib/side-chat"
import type { SideChatMessage } from "@/store/types"

describe("newSideChatThread", () => {
  it("contextBoundary = parent modelMessages uzunluğu, messages boş", () => {
    const t = newSideChatThread(7, "msg_test", 1234)
    expect(t).toEqual({
      id: "msg_test",
      createdAt: 1234,
      contextBoundary: 7,
      messages: [],
    })
  })

  it("negatif sayıyı 0'a sabitler", () => {
    expect(newSideChatThread(-3, "x", 1).contextBoundary).toBe(0)
  })

  it("id/createdAt verilmezse üretir (id msg_ önekli, createdAt > 0)", () => {
    const t = newSideChatThread(0)
    expect(t.id.startsWith("msg_")).toBe(true)
    expect(t.createdAt).toBeGreaterThan(0)
  })
})

describe("buildSideChatMessages", () => {
  const context: ModelMessage[] = [
    { role: "user", content: "merhaba" },
    { role: "assistant", content: "selam, nasıl yardımcı olabilirim?" },
  ]

  it("system başta, context ortada, soru en sonda", () => {
    const out = buildSideChatMessages(context, [], "az önce ne dedin?")
    expect(out).toHaveLength(4)
    expect(out[0]).toEqual({ role: "system", content: SIDE_CHAT_SYSTEM })
    expect(out[1]).toEqual(context[0])
    expect(out[2]).toEqual(context[1])
    expect(out[3]).toEqual({ role: "user", content: "az önce ne dedin?" })
  })

  it("önceki yan turları (content) sıraya katar, reasoning'i atar", () => {
    const turns: SideChatMessage[] = [
      { role: "user", content: "özetle" },
      { role: "assistant", content: "şunları konuştuk...", reasoning: "düşünme bloğu" },
    ]
    const out = buildSideChatMessages(context, turns, "peki ya öncesi?")
    expect(out.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ])
    expect(out[4]).toEqual({ role: "assistant", content: "şunları konuştuk..." })
    expect(out[5]).toEqual({ role: "user", content: "peki ya öncesi?" })
  })

  it("pending / boş içerikli turları eler (yarım kalan asistan cevabı)", () => {
    const turns: SideChatMessage[] = [
      { role: "user", content: "soru" },
      { role: "assistant", content: "", pending: true },
    ]
    const out = buildSideChatMessages(context, turns, "yeni soru")
    expect(out).toHaveLength(5)
    expect(out).toEqual([
      { role: "system", content: SIDE_CHAT_SYSTEM },
      context[0],
      context[1],
      { role: "user", content: "soru" },
      { role: "user", content: "yeni soru" },
    ])
    expect(out.filter((m) => typeof m.content === "string" && m.content.trim() === "")).toHaveLength(0)
  })

  it("özel system prompt geçilebilir", () => {
    const out = buildSideChatMessages([], [], "x", "CUSTOM")
    expect(out[0]).toEqual({ role: "system", content: "CUSTOM" })
  })
})
