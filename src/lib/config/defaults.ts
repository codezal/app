// The canonical default Settings object.
//
// Extracted from the settings store so that pure consumers (the JSON Schema
// generator in tests/settings-schema.test.ts, future tooling) can read the
// defaults without pulling in the store's runtime graph (zustand, Tauri fs).
// The store imports DEFAULT_SETTINGS from here; this is the single source of
// truth for every field's default value.
import { PROVIDERS } from "@/lib/providers"
import { DEFAULT_LOCALE } from "@/lib/i18n"
import { DEFAULT_APPEARANCE } from "@/lib/theme"
import { DEFAULT_TOKEN_SAVERS } from "@/lib/token-savers/types"
import { DEFAULT_MEMORY } from "@/lib/memory-settings"
import { DEFAULT_PRIVACY } from "@/lib/privacy"
import { DEFAULT_INFERENCE_SERVER } from "@/lib/inference-server"
import { defaultAgentProvidersSettings } from "@/lib/agent-providers"
import { CURRENT_SCHEMA_VERSION } from "./migrate"
import type { Settings } from "@/store/types"

export const DEFAULT_SETTINGS: Settings = {
  // Links a hand-edited settings.json to its JSON Schema (sidecar in AppData).
  // parseSettings carries this into every loaded config, so it is written back
  // on the next save and editors pick up autocomplete automatically.
  $schema: "./settings.schema.json",
  apiKeys: {},
  defaultProvider: "openai",
  defaultModel: PROVIDERS.openai.defaultModel,
  theme: "system",
  fontScale: "m",
  language: DEFAULT_LOCALE,
  // Safe default: every tool call is asked ("Default permissions"). No automatic
  // bash/exec until the user explicitly opts into Full access (bypass).
  approvalMode: "ask",
  approvalRules: [],
  permission: [],
  mcpServers: [],
  autoCompact: {
    enabled: true,
    triggerPct: 90,
    targetPct: 40,
    keepLast: 10,
  },
  localLlm: {
    contextWindow: 32768,
    flashAttention: "enabled",
    batchSize: 2048,
    threads: 0,
    batchThreads: 0,
    speculativeMode: "off",
    draftTokens: 4,
    draftModel: "",
    agentMode: true,
  },
  hooks: [],
  semantic: {
    enabled: false,
    provider: "ollama",
    baseUrl: "",
    model: "nomic-embed-text",
    apiKey: "",
    topK: 5,
  },
  appearance: DEFAULT_APPEARANCE,
  tokenSavers: DEFAULT_TOKEN_SAVERS,
  memory: DEFAULT_MEMORY,
  privacy: DEFAULT_PRIVACY,
  inferenceServer: DEFAULT_INFERENCE_SERVER,
  credentials: {},
  providerConfigs: {},
  agentProviders: defaultAgentProvidersSettings(),
  customProviders: [],
  envFallback: true,
  modelStatus: {},
  autoLintOnEdit: true,
  securityScan: true,
  narrateProgress: true,
  crashReporting: true,
  feedbackNoticeSeen: false,
  onboardingCompleted: false,
  forkSubagent: false,
  vimMode: false,
  autoUpdate: true,
  openFilesPanelOnLaunch: true,
  suggestionsEnabled: false,
  disabledSkills: [],
  monitorAction: "respond",
  autopilot: { runInBackground: false, autostart: false, keepAwake: false },
  schemaVersion: CURRENT_SCHEMA_VERSION,
}
