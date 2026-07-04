//
//   PreToolUse        — payload: { tool, input } → exit≠0 + blocking=true ise tool durur, stderr hata olur.
//                       "goal_done" | "goal_blocked" | "goal_max_iter". notify; ignore output.
//                       "error" | "aborted". notify; ignore output.
//
// Komuta payload stdin'den JSON olarak verilir. workspace cwd. Tauri shell plugin.
import { runShell } from "@/lib/exec"
import type { HookConfig, HookEvent } from "@/store/types"
import { errorMessage } from "@/lib/errors"

const DEFAULT_TIMEOUT = 10_000

// --- Plugin hook trust ("trust review") ---
const TRUST_KEY = "codezal:trusted-plugin-hooks"

function loadTrusted(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set()
    const raw = localStorage.getItem(TRUST_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

const trustedPluginHooks = loadTrusted()
const warnedUntrusted = new Set<string>()

export function isPluginHookTrusted(id: string): boolean {
  return trustedPluginHooks.has(id)
}

export function setPluginHookTrusted(id: string, trusted: boolean): void {
  if (trusted) trustedPluginHooks.add(id)
  else trustedPluginHooks.delete(id)
  warnedUntrusted.delete(id)
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TRUST_KEY, JSON.stringify([...trustedPluginHooks]))
    }
  } catch {
    // Intentionally ignored.
  }
}

export type HookResult = {
  ranCount: number
  blocked: boolean
  blockReason?: string
  extraContext?: string
  modifiedInput?: unknown
  autoApprove?: boolean
}

type PreToolPayload = { tool: string; input: unknown }
type PostToolPayload = { tool: string; input: unknown; output: string; isError?: boolean }
type PromptPayload = { prompt: string }
type StopPayload = { reason: string }
type PreCompactPayload = { tokenCount: number }
type SubagentStartPayload = { agent: string; task: string }

export type HookPayload =
  | PreToolPayload
  | PostToolPayload
  | PromptPayload
  | StopPayload
  | PreCompactPayload
  | SubagentStartPayload

function matches(hook: HookConfig, toolName?: string): boolean {
  if (hook.enabled === false) return false
  if (!hook.matcher || hook.matcher === "*") return true
  if (!toolName) return true
  return hook.matcher === toolName
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

async function execHook(
  hook: HookConfig,
  payload: HookPayload,
  workspace: string | undefined,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const enriched = { ...payload, hook_event_name: hook.event }
  const json = JSON.stringify(enriched)
  const cwd = workspace ? `cd ${shellQuote(workspace)} && ` : ""
  const wrapped = `${cwd}echo ${shellQuote(json)} | { export CODEZAL_HOOK_EVENT=${shellQuote(hook.event)}; export CODEZAL_HOOK_PAYLOAD=${shellQuote(json)}; ${hook.command}; }`
  const timeout = hook.timeoutMs ?? DEFAULT_TIMEOUT
  try {
    const out = await runShell(wrapped, { timeoutMs: timeout })
    return { stdout: out.stdout, stderr: out.stderr, code: out.code }
  } catch (e) {
    return { stdout: "", stderr: errorMessage(e), code: -1 }
  }
}

// decision: "block"/"deny" reddeder, "allow" izin verir (PreToolUse + PermissionRequest).
function parseDecision(
  stdout: string,
): { decision?: "block" | "allow" | "deny"; reason?: string; input?: unknown } | null {
  const t = stdout.trim()
  if (!t.startsWith("{")) return null
  try {
    const obj = JSON.parse(t) as {
      decision?: "block" | "allow" | "deny"
      reason?: string
      input?: unknown
    }
    if (
      obj &&
      (obj.decision === "block" ||
        obj.decision === "allow" ||
        obj.decision === "deny" ||
        obj.input !== undefined)
    ) {
      return obj
    }
    return null
  } catch {
    return null
  }
}

export async function runHooks(args: {
  hooks: HookConfig[] | undefined
  event: HookEvent
  toolName?: string
  payload: HookPayload
  workspace: string | undefined
}): Promise<HookResult> {
  const list = (args.hooks ?? []).filter((h) => h.event === args.event && matches(h, args.toolName))
  if (list.length === 0) return { ranCount: 0, blocked: false }

  let extraContext = ""
  let modifiedInput: unknown
  let autoApprove = false
  let payload = args.payload
  for (const h of list) {
    if (h.pluginId && !trustedPluginHooks.has(h.id)) {
      if (!warnedUntrusted.has(h.id)) {
        warnedUntrusted.add(h.id)
        console.warn(
          `[hook] güven verilmemiş plugin hook atlandı: '${h.id}' (${h.pluginId}) — Ayarlar > Hooks'tan güven verin`,
        )
      }
      continue
    }
    const r = await execHook(h, payload, args.workspace)
    if (args.event === "PreToolUse") {
      const decision = parseDecision(r.stdout)
      if (h.blocking && (decision?.decision === "block" || (r.code !== 0 && decision?.decision !== "allow"))) {
        const reason =
          decision?.reason ??
          (r.stderr.trim() || `Hook '${h.id}' exit ${r.code}`)
        console.warn(`[hook] BLOCK ${h.event} matcher=${h.matcher ?? "*"} reason=${reason}`)
        return { ranCount: list.indexOf(h) + 1, blocked: true, blockReason: reason }
      }
      if (decision?.input !== undefined) {
        modifiedInput = decision.input
        payload = { ...(payload as Record<string, unknown>), input: decision.input } as HookPayload
      }
    } else if (args.event === "PermissionRequest") {
      // {decision:"deny"} → reddet (blocked); {decision:"allow"} → otomatik onayla.
      const decision = parseDecision(r.stdout)
      if (decision?.decision === "deny") {
        const reason = decision.reason ?? (r.stderr.trim() || `Hook '${h.id}' reddetti`)
        return { ranCount: list.indexOf(h) + 1, blocked: true, blockReason: reason }
      }
      if (decision?.decision === "allow") autoApprove = true
    } else if (args.event === "UserPromptSubmit" && r.code === 0 && r.stdout.trim()) {
      extraContext += (extraContext ? "\n\n" : "") + r.stdout.trim()
    }
    if (r.code !== 0) {
      console.warn(`[hook] ${h.event} ${h.matcher ?? "*"} exit ${r.code}: ${r.stderr.trim()}`)
    }
  }
  return {
    ranCount: list.length,
    blocked: false,
    extraContext: extraContext || undefined,
    modifiedInput,
    autoApprove: autoApprove || undefined,
  }
}

const pluginHooks: HookConfig[] = []

export function listPluginHooks(): HookConfig[] {
  return [...pluginHooks]
}

export function _registerPluginHook(h: HookConfig): void {
  // Namespace the hook id by its plugin so a malicious plugin cannot inherit
  // another plugin's trust (trustedPluginHooks keys on id) — or replace its
  // hook via the dedup below — by reusing a hook id. Idempotent on re-register.
  const reg: HookConfig =
    h.pluginId && !h.id.startsWith(`${h.pluginId}:`)
      ? { ...h, id: `${h.pluginId}:${h.id}` }
      : h
  const idx = pluginHooks.findIndex((x) => x.id === reg.id)
  if (idx >= 0) pluginHooks.splice(idx, 1, reg)
  else pluginHooks.push(reg)
}

export function _unregisterPluginHooks(pluginId: string): void {
  for (let i = pluginHooks.length - 1; i >= 0; i--) {
    if (pluginHooks[i].pluginId === pluginId) pluginHooks.splice(i, 1)
  }
}

export function _clearPluginHooks(): void {
  pluginHooks.length = 0
}
