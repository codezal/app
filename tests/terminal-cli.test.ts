import { describe, expect, it, vi } from "vitest"
import { detectInstalledTerminalCliTools } from "@/lib/terminal-cli"

describe("terminal CLI discovery", () => {
  it("returns only commands installed on the system", async () => {
    const available = vi.fn(async () => [
      { name: "codex", launchCommand: "'/Applications/ChatGPT.app/Contents/Resources/codex'" },
      { name: "opencode", launchCommand: "opencode" },
    ])

    const installed = await detectInstalledTerminalCliTools(available)

    expect(installed.map((tool) => tool.id)).toEqual(["codex", "opencode"])
    expect(installed.map((tool) => tool.launchCommand)).toEqual([
      "'/Applications/ChatGPT.app/Contents/Resources/codex'",
      "opencode",
    ])
    expect(available).toHaveBeenCalledWith([
      "codex",
      "claude",
      "opencode",
      "grok",
      "gemini",
      "kimi",
      "aider",
      "goose",
    ])
  })
})
