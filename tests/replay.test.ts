// replay extractUserPrompts — pure logic.
import { describe, it, expect } from "vitest"
import { extractUserPrompts } from "@/lib/replay"
import type { Session, Message } from "@/store/types"

function msg(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: 0 }
}

function makeSession(messages: Message[]): Session {
  return {
    id: "s1",
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    provider: "openai",
    model: "x",
    messages,
  }
}

describe("extractUserPrompts", () => {
  it("sadece user mesajları döner", () => {
    const s = makeSession([
      msg("user", "ilk"),
      msg("assistant", "cevap"),
      msg("user", "ikinci"),
      msg("system", "kural"),
      msg("user", "üçüncü"),
    ])
    expect(extractUserPrompts(s)).toEqual(["ilk", "ikinci", "üçüncü"])
  })

  it("boş veya whitespace user mesajları atılır", () => {
    const s = makeSession([
      msg("user", "   "),
      msg("user", ""),
      msg("user", "geçerli"),
    ])
    expect(extractUserPrompts(s)).toEqual(["geçerli"])
  })

  it("hiç user yok → boş array", () => {
    const s = makeSession([msg("assistant", "selam")])
    expect(extractUserPrompts(s)).toEqual([])
  })

  it("trim uygular", () => {
    const s = makeSession([msg("user", "  promptum  ")])
    expect(extractUserPrompts(s)).toEqual(["promptum"])
  })
})
