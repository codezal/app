// Runtime validation for the settings file.
//
// Goal: a hand-edited or out-of-date `settings.json` must never crash the app
// or silently produce a half-broken Settings object. We validate the loaded
// data against a zod schema that is *lenient* — every field carries a default
// and a `.catch()`, so a malformed value degrades to its default instead of
// failing the whole parse. This replaces the hand-rolled nested-merge that used
// to live in the settings store's load().
//
// Opaque/free-form blobs (theme tokens, credentials, provider configs, the
// models.dev catalog) are modelled loosely on purpose — the app reads them
// through their own typed accessors, so over-specifying them here would be
// brittle. A single documented cast bridges the inferred schema type to the
// hand-written Settings type at the validated boundary.

import { z } from "zod"
import type { Settings } from "@/store/types"

// A record whose values are unconstrained — used for free-form blobs.
const looseRecord = z.record(z.string(), z.unknown())

// OAuth credential shape (mirrors providers/types.ts OAuthCredential). Unlike
// the other free-form blobs, a malformed credential is actively dangerous — a
// missing/short accessToken would be handed to a provider SDK and fail at call
// time with an opaque auth error. So we validate each entry and drop bad ones.
const OAuthCredentialSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    meta: z.record(z.string(), z.string()).optional(),
  })
  // Tolerate unknown extra keys (forward-compat) but require the core shape.
  .loose()

// Validate a credentials blob, keeping only entries that parse. A corrupt or
// partially-written entry is dropped rather than poisoning the whole record.
function sanitizeCredentials(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {}
  const out: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const result = OAuthCredentialSchema.safeParse(value)
    if (result.success) out[id] = result.data
  }
  return out
}

const McpServerSchema = z
  .object({
    name: z.string(),
    url: z.string().catch(""),
    headers: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["http", "sse", "stdio"]).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    oauth: z.unknown().optional(),
    timeout: z.number().optional(),
    enabled: z.boolean().optional(),
    pluginId: z.string().optional(),
  })
  // Tolerate unknown keys rather than stripping them — forward-compat with
  // configs written by a newer build.
  .loose()

const HookSchema = z
  .object({
    id: z.string(),
    event: z.enum(["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest"]),
    matcher: z.string().optional(),
    command: z.string(),
    timeoutMs: z.number().optional(),
    blocking: z.boolean().optional(),
    enabled: z.boolean().optional(),
    description: z.string().optional(),
    pluginId: z.string().optional(),
  })
  .loose()

const ApprovalRuleSchema = z
  .object({
    tool: z.string(),
    pattern: z.string().optional(),
    decision: z.enum(["allow", "deny", "ask"]),
    scope: z.enum(["session", "persistent"]).optional(),
  })
  .loose()

const PermissionRuleSchema = z
  .object({
    permission: z.string(),
    pattern: z.string(),
    action: z.enum(["allow", "deny", "ask"]),
  })
  .loose()

const CustomProviderSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(""),
    baseURL: z.string().min(1),
    models: z
      .array(z.object({ id: z.string().min(1), name: z.string().optional() }).loose())
      .catch([]),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .loose()

// Build the schema around a concrete defaults object so every field's fallback
// is sourced from one place (the store's DEFAULT). Each top-level field is
// `.catch(default)` so a bad value can never abort the whole parse.
//
// Exported so the JSON Schema generator (tests/settings-schema.test.ts) can
// emit a `settings.schema.json` from the exact same shape used at runtime —
// the schema can never drift from validation because there is one source.
export function makeSchema(d: Settings) {
  return z
    .object({
      schemaVersion: z.number().optional(),
      apiKeys: z.record(z.string(), z.string()).catch(d.apiKeys as Record<string, string>),
      defaultProvider: z.string().catch(d.defaultProvider),
      defaultModel: z.string().catch(d.defaultModel),
      theme: z.enum(["light", "dark", "system"]).catch(d.theme),
      fontScale: z.enum(["s", "m", "l", "xl"]).optional().catch(d.fontScale),
      language: z.string().optional().catch(d.language),
      defaultWorkspacePath: z.string().optional(),
      defaultAgent: z.string().optional().catch(d.defaultAgent),
      bashTimeoutMs: z.number().optional().catch(d.bashTimeoutMs),
      sessionSpendCapUsd: z.number().optional().catch(d.sessionSpendCapUsd),
      commitAttribution: z.boolean().optional().catch(d.commitAttribution),
      cleanupPeriodDays: z.number().optional().catch(d.cleanupPeriodDays),
      approvalMode: z.enum(["ask", "auto-review", "bypass"]).catch(d.approvalMode),
      approvalRules: z.array(ApprovalRuleSchema).catch(d.approvalRules),
      permission: z.array(PermissionRuleSchema).optional().catch(d.permission ?? []),
      mcpServers: z.array(McpServerSchema).catch(d.mcpServers),
      autoCompact: z
        .object({
          enabled: z.boolean().catch(d.autoCompact.enabled),
          triggerPct: z.number().catch(d.autoCompact.triggerPct),
          targetPct: z.number().catch(d.autoCompact.targetPct),
          model: z.string().optional(),
          keepLast: z.number().catch(d.autoCompact.keepLast),
        })
        .catch(d.autoCompact),
      localLlm: z
        .object({
          contextWindow: z.number().catch(32768),
          flashAttention: z.enum(["enabled", "auto", "disabled"]).catch("enabled"),
          batchSize: z.number().catch(2048),
          threads: z.number().catch(0),
          batchThreads: z.number().catch(0),
          speculativeMode: z.enum(["off", "mtp"]).catch("off"),
          draftTokens: z.number().catch(4),
          draftModel: z.string().catch(""),
          agentMode: z.boolean().catch(true),
        })
        .optional()
        .catch(undefined),
      localLlmByModel: z
        .record(
          z.string(),
          z.object({
            contextWindow: z.number().catch(32768),
            flashAttention: z.enum(["enabled", "auto", "disabled"]).catch("enabled"),
            batchSize: z.number().catch(2048),
            threads: z.number().catch(0),
            batchThreads: z.number().catch(0),
            speculativeMode: z.enum(["off", "mtp"]).catch("off"),
            draftTokens: z.number().catch(4),
            draftModel: z.string().catch(""),
            agentMode: z.boolean().catch(true),
          }),
        )
        .optional()
        .catch(undefined),
      webSearch: z
        .object({
          provider: z.enum(["tavily", "brave", "exa", "duckduckgo"]),
          apiKey: z.string().optional(),
        })
        .optional()
        .catch(undefined),
      firecrawl: z.object({ apiKey: z.string().optional() }).optional().catch(undefined),
      // Image generation — enables generate_image when configured. Lenient: a bad
      // protocol/field degrades this block to undefined, not the whole settings.
      imageGeneration: z
        .object({
          enabled: z.boolean().catch(false),
          providerId: z.string().catch(""),
          baseUrl: z.string().optional(),
          apiKey: z.string().optional(),
          model: z.string().catch(""),
          defaultSize: z.string().optional(),
          timeoutMs: z.number().optional(),
        })
        .optional()
        .catch(undefined),
      providerCatalog: looseRecord.optional(),
      hooks: z.array(HookSchema).optional().catch(d.hooks),
      semantic: z
        .object({
          enabled: z.boolean(),
          provider: z.enum(["openai", "ollama", "custom"]),
          baseUrl: z.string().optional(),
          model: z.string(),
          apiKey: z.string().optional(),
          topK: z.number().optional(),
          autoContext: z.boolean().optional(),
        })
        .optional()
        .catch(d.semantic),
      // Free-form blobs — validated loosely, repaired/merged by their own modules.
      appearance: looseRecord.optional().catch(d.appearance as Record<string, unknown>),
      tokenSavers: looseRecord.optional().catch(d.tokenSavers as Record<string, unknown>),
      memory: looseRecord.optional().catch(d.memory as Record<string, unknown>),
      privacy: looseRecord.optional().catch(d.privacy as unknown as Record<string, unknown>),
      inferenceServer: z
        .object({
          enabled: z.boolean().catch(false),
          port: z.number().int().min(1).max(65535).catch(1456),
          expose: z.boolean().catch(false),
        })
        .optional()
        .catch(d.inferenceServer),
      credentials: looseRecord.optional(),
      providerConfigs: looseRecord.optional(),
      customProviders: z
        .array(CustomProviderSchema.catch({ id: "", name: "", baseURL: "", models: [] }))
        .optional()
        .catch(d.customProviders ?? []),
      envFallback: z.boolean().optional().catch(d.envFallback),
      modelStatus: looseRecord.optional(),
      terminalShortPrompt: z.boolean().optional(),
      terminalRestore: z.boolean().optional(),
      openFilesPanelOnLaunch: z.boolean().optional().catch(d.openFilesPanelOnLaunch),
      suggestionsEnabled: z.boolean().optional().catch(d.suggestionsEnabled),
      autoLintOnEdit: z.boolean().optional().catch(d.autoLintOnEdit),
      securityScan: z.boolean().optional().catch(d.securityScan),
      narrateProgress: z.boolean().optional().catch(d.narrateProgress),
      crashReporting: z.boolean().optional().catch(d.crashReporting),
      feedbackNoticeSeen: z.boolean().optional().catch(d.feedbackNoticeSeen),
      onboardingCompleted: z.boolean().optional().catch(d.onboardingCompleted),
      forkSubagent: z.boolean().optional().catch(d.forkSubagent),
      vimMode: z.boolean().optional().catch(d.vimMode),
      autoUpdate: z.boolean().optional().catch(d.autoUpdate),
      disabledSkills: z.array(z.string()).optional().catch(d.disabledSkills ?? []),
      monitorAction: z.enum(["respond", "chat", "notify"]).optional().catch(d.monitorAction),
      autopilot: z
        .object({
          runInBackground: z.boolean().optional().catch(false),
          autostart: z.boolean().optional().catch(false),
          keepAwake: z.boolean().optional().catch(false),
        })
        .optional()
        .catch(d.autopilot),
    })
    // Keep unknown top-level keys so a config from a newer build round-trips
    // through an older one without data loss.
    .loose()
}

// Shallow-merge a persisted blob over its default, so a config that predates a
// newly-added sub-field keeps the default for that field. Used for the two
// nested blocks whose inner shape the schema leaves loose.
function mergeAppearance(base: Settings["appearance"], over: unknown): Settings["appearance"] {
  if (typeof over !== "object" || over === null) return base
  const o = over as Record<string, unknown>
  return {
    ...base,
    ...o,
    customsByPreset: {
      ...(base?.customsByPreset ?? {}),
      ...((o.customsByPreset as Record<string, unknown>) ?? {}),
    },
  } as Settings["appearance"]
}

// Three-level merge for token savers (briefMode / compactOutput.filters /
// codeMap / historyHygiene) so adding a future sub-toggle doesn't wipe a user's
// existing ones.
function mergeTokenSavers(base: Settings["tokenSavers"], over: unknown): Settings["tokenSavers"] {
  if (!base || typeof over !== "object" || over === null) return base
  const o = over as Record<string, unknown>
  const co = (o.compactOutput as Record<string, unknown>) ?? {}
  return {
    briefMode: { ...base.briefMode, ...((o.briefMode as object) ?? {}) },
    compactOutput: {
      ...base.compactOutput,
      ...co,
      filters: { ...base.compactOutput.filters, ...((co.filters as object) ?? {}) },
    },
    codeMap: { ...base.codeMap, ...((o.codeMap as object) ?? {}) },
    deferMcpTools: typeof o.deferMcpTools === "boolean" ? o.deferMcpTools : base.deferMcpTools,
    compressToolDescriptions:
      typeof o.compressToolDescriptions === "boolean"
        ? o.compressToolDescriptions
        : base.compressToolDescriptions,
    historyHygiene: { ...base.historyHygiene, ...((o.historyHygiene as object) ?? {}) },
  } as Settings["tokenSavers"]
}

// Shallow-merge memory settings over the default so a config predating a newly
// added field (e.g. a future toggle) keeps that field's default rather than
// having it wiped. `instructions` is replaced wholesale when present (a list,
// not a set of independent toggles).
function mergeMemory(base: Settings["memory"], over: unknown): Settings["memory"] {
  if (!base || typeof over !== "object" || over === null) return base
  const o = over as Record<string, unknown>
  return {
    ...base,
    ...o,
    instructions: Array.isArray(o.instructions) ? (o.instructions as string[]) : base.instructions,
  } as Settings["memory"]
}

// Shallow-merge privacy settings over the default so a config predating a newly
// added detector keeps its default. `detectors` and `customPatterns` are
// replaced wholesale when present (a map / list, not independent toggles).
function mergePrivacy(base: Settings["privacy"], over: unknown): Settings["privacy"] {
  if (!base || typeof over !== "object" || over === null) return base
  const o = over as Record<string, unknown>
  return {
    ...base,
    ...o,
    detectors:
      typeof o.detectors === "object" && o.detectors !== null
        ? (o.detectors as NonNullable<Settings["privacy"]>["detectors"])
        : base.detectors,
    customPatterns: Array.isArray(o.customPatterns)
      ? (o.customPatterns as NonNullable<Settings["privacy"]>["customPatterns"])
      : base.customPatterns,
  } as Settings["privacy"]
}

// ---- Project-level config (`<workspace>/.codezal/config.json`) ------------
//
// A small, hand-edited subset of Settings that a workspace can override. All
// fields optional; absent fields fall through to the global settings.
const ProjectConfigSchema = z
  .object({
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    approvalMode: z.enum(["ask", "auto-review", "bypass"]).optional(),
    mcpServers: z.array(McpServerSchema).optional(),
    hooks: z.array(HookSchema).optional(),
    approvalRules: z.array(ApprovalRuleSchema).optional(),
    permission: z.array(PermissionRuleSchema).optional(),
    // A workspace may add extra memory instruction SOURCES. Only the list is
    // accepted here; merge.ts sanitizes it (workspace-relative globs only — no
    // URL / absolute / ~ from untrusted project scope).
    memory: z.object({ instructions: z.array(z.string()).optional() }).loose().optional(),
  })
  .loose()

// Typed against the Settings subset so it merges cleanly (see merge.ts).
export type ProjectConfig = {
  defaultProvider?: string
  defaultModel?: string
  approvalMode?: Settings["approvalMode"]
  mcpServers?: Settings["mcpServers"]
  hooks?: Settings["hooks"]
  approvalRules?: Settings["approvalRules"]
  permission?: Settings["permission"]
  memory?: { instructions?: string[] }
}

// Validate raw project-config data. Returns null on hard failure (caller then
// falls back to global settings).
export function parseProjectConfig(raw: unknown): ProjectConfig | null {
  const result = ProjectConfigSchema.safeParse(raw ?? {})
  if (!result.success) {
    console.warn("[config] project config parse failed, ignoring:", result.error.issues)
    return null
  }
  return result.data as ProjectConfig
}

// Validate + repair raw settings data against the schema, filling defaults for
// missing or malformed fields. Never throws: on a hard schema failure the
// defaults are returned unchanged. The raw input is expected to have already
// passed through migrateSettings() (legacy-shape transforms).
export function parseSettings(raw: unknown, defaults: Settings): Settings {
  const schema = makeSchema(defaults)
  const result = schema.safeParse(raw ?? {})
  if (!result.success) {
    console.warn("[config] settings schema parse failed, using defaults:", result.error.issues)
    return defaults
  }
  // The schema validates the structurally-significant fields and leaves opaque
  // blobs loose; bridge to the hand-written Settings type at this boundary.
  const parsed = result.data as unknown as Partial<Settings> & Record<string, unknown>
  const appearance = mergeAppearance(defaults.appearance, parsed.appearance)
  const tokenSavers = mergeTokenSavers(defaults.tokenSavers, parsed.tokenSavers)
  const memory = mergeMemory(defaults.memory, parsed.memory)
  const privacy = mergePrivacy(defaults.privacy, parsed.privacy)
  // Drop malformed OAuth credentials so a corrupt entry can't reach a provider
  // SDK. (Secrets now live in the keychain; any credentials still on disk are
  // legacy entries about to be migrated — validate them before that happens.)
  const credentials = sanitizeCredentials(parsed.credentials) as Settings["credentials"]
  // Drop degenerate custom providers (empty id/baseURL) that the element-level
  // .catch produced from malformed entries, so they neither render nor linger.
  const customProviders = Array.isArray(parsed.customProviders)
    ? parsed.customProviders.filter((c) => {
        const o = c as { id?: string; baseURL?: string }
        return Boolean(o?.id?.trim()) && Boolean(o?.baseURL?.trim())
      })
    : defaults.customProviders
  return {
    ...defaults,
    ...parsed,
    appearance,
    tokenSavers,
    memory,
    privacy,
    credentials,
    customProviders,
    // Keep the legacy `theme` field in sync with appearance.mode for any reader
    // that still consults it.
    theme: appearance?.mode ?? defaults.theme,
  }
}
