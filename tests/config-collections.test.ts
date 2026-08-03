// M18 — element-wise tolerance for settings collection fields. A single
// malformed element (mcp server / hook / approval rule / permission rule /
// apiKey entry) must be dropped WITHOUT wiping the rest of the collection.
import { describe, it, expect } from "vitest"
import { parseSettings, parseProjectConfig } from "@/lib/config/schema"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"

const base = { ...DEFAULT_SETTINGS, mcpServers: [], hooks: [], approvalRules: [], permission: [] }

describe("parseSettings — M18 collection leniency", () => {
  it("one malformed mcpServer is dropped, valid ones survive", () => {
    const s = parseSettings(
      {
        mcpServers: [
          { name: "good", command: "npx", args: ["-y", "server"] },
          { name: 123 }, // malformed (name not a string)
          { name: "also-good", url: "https://example.com/mcp" },
        ],
      },
      base,
    )
    const names = s.mcpServers.map((m) => m.name)
    expect(names).toContain("good")
    expect(names).toContain("also-good")
    expect(names).not.toContain(123)
    expect(s.mcpServers.length).toBe(2)
  })

  it("one malformed hook is dropped, valid ones survive", () => {
    const s = parseSettings(
      {
        hooks: [
          { id: "h1", event: "PreToolUse", command: "echo ok" },
          { id: "bad" }, // missing event/command
          { id: "h2", event: "Stop", command: "echo done" },
        ],
      },
      base,
    )
    expect(s.hooks?.map((h) => h.id)).toEqual(["h1", "h2"])
  })

  it("non-string apiKey values are dropped, string keys survive", () => {
    const s = parseSettings(
      { apiKeys: { openai: "sk-real", anthropic: 42, gemini: "ok" } },
      base,
    )
    expect(s.apiKeys).toEqual({ openai: "sk-real", gemini: "ok" })
  })

  it("empty collections stay empty (not replaced by defaults)", () => {
    const s = parseSettings({ mcpServers: [], approvalRules: [] }, base)
    expect(s.mcpServers).toEqual([])
    expect(s.approvalRules).toEqual([])
  })
})

describe("parseProjectConfig — M18 collection leniency", () => {
  it("malformed project mcpServer dropped, valid kept", () => {
    const cfg = parseProjectConfig({
      mcpServers: [
        { name: "ok", command: "npx", args: [] },
        { name: ["not", "a", "string"] },
      ],
    })
    expect(cfg).not.toBeNull()
    expect(cfg?.mcpServers?.map((m) => m.name)).toEqual(["ok"])
  })
})
