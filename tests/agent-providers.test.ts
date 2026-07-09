import { describe, expect, it } from "vitest"
import {
  defaultAgentProvidersSettings,
  listVisibleAgentProviders,
  modelsForAgentProvider,
  resolveNativeAgentMode,
} from "@/lib/agent-providers"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"
import { parseSettings } from "@/lib/config/schema"

describe("CLI agent providers", () => {
  it("defaults keep Codex and Claude visible in picker order", () => {
    const settings = { ...DEFAULT_SETTINGS, agentProviders: defaultAgentProvidersSettings() }
    expect(listVisibleAgentProviders(settings).map((p) => p.id)).toEqual([
      "codex-cli",
      "claude-cli",
    ])
    expect(settings.agentProviders["codex-cli"]?.injectCodezalTools).toBe(true)
    expect(settings.agentProviders["claude-cli"]?.injectCodezalTools).toBe(true)
  })

  it("custom model slugs override provider fallback models", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentProviders: {
        "codex-cli": { models: ["gpt-custom", "gpt-next"] },
      },
    }
    expect(modelsForAgentProvider("codex-cli", settings)).toEqual(["gpt-custom", "gpt-next"])
  })

  it("discovered model cache feeds picker models after custom slugs", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentProviders: {
        "codex-cli": {
          models: ["gpt-custom"],
          discoveredModels: [
            { id: "gpt-live", label: "GPT Live", source: "runtime" as const },
            { id: "gpt-custom", label: "Duplicate", source: "runtime" as const },
          ],
        },
      },
    }
    expect(modelsForAgentProvider("codex-cli", settings)).toEqual(["gpt-custom", "gpt-live"])
  })

  it("mode mapping follows approval mode and plan sessions", () => {
    expect(resolveNativeAgentMode({ approvalMode: "ask", sessionMode: "build" })).toBe("ask")
    expect(resolveNativeAgentMode({ approvalMode: "auto-review", sessionMode: "build" })).toBe(
      "auto-review",
    )
    expect(resolveNativeAgentMode({ approvalMode: "bypass", sessionMode: "build" })).toBe("bypass")
    expect(resolveNativeAgentMode({ approvalMode: "bypass", sessionMode: "plan" })).toBe("plan")
  })

  it("settings schema preserves valid CLI agent overrides and repairs malformed fields", () => {
    const parsed = parseSettings(
      {
        ...DEFAULT_SETTINGS,
        agentProviders: {
          "codex-cli": {
            enabled: false,
            injectCodezalTools: false,
            order: 4,
            command: "codex app-server --experimental",
            env: { CODEZAL_TEST: "1" },
            models: ["gpt-custom"],
            discoveredModels: [{ id: "gpt-live", label: "GPT Live", source: "runtime" }],
            modelsFetchedAt: 123,
            lastStatus: "available",
            lastVersion: "codex-cli 1.2.3",
            lastCheckedAt: 456,
          },
          "claude-cli": {
            enabled: "yes",
            injectCodezalTools: "no",
            env: { BAD: 1 },
            models: [123],
            discoveredModels: [{ label: "Missing ID" }],
            lastStatus: "weird",
          },
        },
      },
      DEFAULT_SETTINGS,
    )
    expect(parsed.agentProviders?.["codex-cli"]).toEqual({
      enabled: false,
      injectCodezalTools: false,
      order: 4,
      command: "codex app-server --experimental",
      env: { CODEZAL_TEST: "1" },
      models: ["gpt-custom"],
      discoveredModels: [{ id: "gpt-live", label: "GPT Live", source: "runtime" }],
      modelsFetchedAt: 123,
      lastStatus: "available",
      lastVersion: "codex-cli 1.2.3",
      lastCheckedAt: 456,
    })
    expect(parsed.agentProviders?.["claude-cli"]?.enabled).toBeUndefined()
    expect(parsed.agentProviders?.["claude-cli"]?.injectCodezalTools).toBeUndefined()
    expect(parsed.agentProviders?.["claude-cli"]?.env).toBeUndefined()
    expect(parsed.agentProviders?.["claude-cli"]?.models).toBeUndefined()
    expect(parsed.agentProviders?.["claude-cli"]?.discoveredModels).toBeUndefined()
    expect(parsed.agentProviders?.["claude-cli"]?.lastStatus).toBeUndefined()
  })
})
