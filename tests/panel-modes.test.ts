import { describe, expect, it } from "vitest"
import { resolvePanelReopenMode } from "@/lib/panel-modes"

describe("resolvePanelReopenMode", () => {
  it("re-opens the last mode when it is not session-bound", () => {
    expect(
      resolvePanelReopenMode("git", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("git")
    expect(
      resolvePanelReopenMode("files", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("files")
  })

  it("falls back to files when todo has no active todos in the current session", () => {
    expect(
      resolvePanelReopenMode("todo", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("files")
  })

  it("keeps todo when the current session has active todos", () => {
    expect(
      resolvePanelReopenMode("todo", { hasActiveTodos: true, hasSuggestions: false }),
    ).toBe("todo")
  })

  it("falls back to files when suggestions has no items in the current session", () => {
    expect(
      resolvePanelReopenMode("suggestions", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("files")
  })

  it("keeps suggestions when the current session has suggestion items", () => {
    expect(
      resolvePanelReopenMode("suggestions", { hasActiveTodos: false, hasSuggestions: true }),
    ).toBe("suggestions")
  })

  it("falls back to files for AI-transient modes that closed after a run", () => {
    expect(
      resolvePanelReopenMode("agents", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("files")
    expect(
      resolvePanelReopenMode("preview", { hasActiveTodos: false, hasSuggestions: false }),
    ).toBe("files")
  })
})
