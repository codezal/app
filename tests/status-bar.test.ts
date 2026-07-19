import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { StatusBar } from "@/components/StatusBar"

const sessionStoreState = vi.hoisted(() => {
  const active = {
    id: "active",
    title: "Active",
    updatedAt: 1,
    messages: [{ id: "active-message", role: "user", content: "Active" }],
    provider: "openai",
    model: "gpt-4o",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 1, turns: 1 },
  }
  const split = {
    ...active,
    id: "split",
    title: "Split",
    messages: [{ id: "split-message", role: "user", content: "Split" }],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 2, turns: 1 },
  }
  return {
    activeId: active.id,
    active,
    sessions: { active, split },
    updateActiveMeta: vi.fn(),
    updateMetaFor: vi.fn(),
  }
})

vi.mock("@/store/sessions", () => ({
  useSessionsStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}))

vi.mock("@/components/Composer", () => ({
  ApprovalModeMenu: () => createElement("span"),
  WorkspacePicker: () => createElement("span"),
}))

describe("StatusBar", () => {
  it("sessionId verildiğinde split session bilgisini gösterir", () => {
    const html = renderToStaticMarkup(createElement(StatusBar, { sessionId: "split" }))

    expect(html).toContain("$2.0000")
    expect(html).not.toContain("$1.0000")
  })
})
