import { describe, it, expect, beforeEach } from "vitest"
import {
  subscribeSessionMessage,
  emitSessionMessage,
  clearSessionMessageBus,
  type SessionMessageEvent,
} from "@/lib/session-message-bus"

beforeEach(() => clearSessionMessageBus())

const ev = (over: Partial<SessionMessageEvent> = {}): SessionMessageEvent => ({
  toSessionId: "s2",
  fromLabel: "@builder",
  text: "PR 234 ready",
  ...over,
})

describe("session-message-bus", () => {
  it("abone emit'i alır", () => {
    const got: SessionMessageEvent[] = []
    subscribeSessionMessage((e) => got.push(e))
    emitSessionMessage(ev())
    expect(got).toHaveLength(1)
    expect(got[0]).toEqual(ev())
  })

  it("birden fazla abone hepsi tetiklenir", () => {
    let a = 0
    let b = 0
    subscribeSessionMessage(() => a++)
    subscribeSessionMessage(() => b++)
    emitSessionMessage(ev())
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it("unsubscribe sonrası tetiklenmez", () => {
    let n = 0
    const off = subscribeSessionMessage(() => n++)
    emitSessionMessage(ev())
    off()
    emitSessionMessage(ev())
    expect(n).toBe(1)
  })

  it("clear tüm aboneleri kaldırır", () => {
    let n = 0
    subscribeSessionMessage(() => n++)
    clearSessionMessageBus()
    emitSessionMessage(ev())
    expect(n).toBe(0)
  })
})
