import { streamText, generateText, stepCountIs, tool, type ToolSet } from "ai"
import { z } from "zod"
import { listDirAbs, readFileAbs, writeFileAbs, editFileAbs } from "./fs"
import { runBash } from "./shell"
import { sliceCharsSafe } from "@/lib/text"
import { isDoomRepeat, DOOM_REPEAT, DOOM_WINDOW } from "./doom-loop"
import { runFormatters } from "./formatters"
import { searchWorkspace, globWorkspace, type SearchHit } from "../search"
import { webfetch as webfetchImpl, websearch as websearchImpl, firecrawlScrape as firecrawlImpl } from "./web"
import { repoOverview as repoOverviewImpl } from "./repo-overview"
import { applyPatch as applyPatchImpl, formatApplyResult } from "./patch"
import { cloneRepo as cloneRepoImpl } from "./repo-clone"
// Imported as raw strings so prompts can be tuned without touching index.ts.
import READ_DESC from "./prompts/read.txt?raw"
import GREP_DESC from "./prompts/grep.txt?raw"
import GLOB_DESC from "./prompts/glob.txt?raw"
import WRITE_DESC from "./prompts/write.txt?raw"
import EDIT_DESC from "./prompts/edit.txt?raw"
import APPLY_PATCH_DESC from "./prompts/apply_patch.txt?raw"
import BASH_DESC from "./prompts/bash.txt?raw"
import BASH_STATUS_DESC from "./prompts/bash_status.txt?raw"
import LSP_DESC from "./prompts/lsp.txt?raw"
import PROPOSE_BUILD_DESC from "./prompts/propose_build.txt?raw"
import PROPOSE_PLAN_DESC from "./prompts/propose_plan.txt?raw"
import WEBFETCH_DESC from "./prompts/webfetch.txt?raw"
import WEBSEARCH_DESC from "./prompts/websearch.txt?raw"
import QUESTION_DESC from "./prompts/question.txt?raw"
import TODOWRITE_DESC from "./prompts/todowrite.txt?raw"
import REPO_OVERVIEW_DESC from "./prompts/repo_overview.txt?raw"
import REPO_CLONE_DESC from "./prompts/repo_clone.txt?raw"
import CREATE_PR_DESC from "./prompts/create_pr.txt?raw"
import INDEX_DOCS_DESC from "./prompts/index_docs.txt?raw"
import SKILL_DESC from "./prompts/skill.txt?raw"
import SPAWN_AGENT_DESC from "./prompts/spawn_agent.txt?raw"
import DELEGATE_AGENTS_DESC from "./prompts/delegate_agents.txt?raw"
import RUN_WORKFLOW_DESC from "./prompts/run_workflow.txt?raw"
import WORKFLOW_STATUS_DESC from "./prompts/workflow_status.txt?raw"
import REMEMBER_DESC from "./prompts/remember.txt?raw"
import NOTEBOOK_EDIT_DESC from "./prompts/notebook_edit.txt?raw"
import NOTIFY_DESC from "./prompts/notify.txt?raw"
import MCP_RESOURCE_DESC from "./prompts/mcp_resource.txt?raw"
import SCHEDULE_TASK_DESC from "./prompts/schedule_task.txt?raw"
import MONITOR_DESC from "./prompts/monitor.txt?raw"
import SEND_TO_SESSION_DESC from "./prompts/send_to_session.txt?raw"
import SET_SESSION_HANDLE_DESC from "./prompts/set_session_handle.txt?raw"
import BROWSER_NAVIGATE_DESC from "./prompts/browser_navigate.txt?raw"
import BROWSER_SCREENSHOT_DESC from "./prompts/browser_screenshot.txt?raw"
import BROWSER_CONSOLE_DESC from "./prompts/browser_read_console.txt?raw"
import BROWSER_NETWORK_DESC from "./prompts/browser_read_network.txt?raw"
import BROWSER_SNAPSHOT_DESC from "./prompts/browser_snapshot.txt?raw"
import BROWSER_CLICK_DESC from "./prompts/browser_click.txt?raw"
import BROWSER_FILL_DESC from "./prompts/browser_fill.txt?raw"
import BROWSER_SELECT_DESC from "./prompts/browser_select.txt?raw"
import BROWSER_PRESS_DESC from "./prompts/browser_press.txt?raw"
import BROWSER_TYPE_DESC from "./prompts/browser_type.txt?raw"
import BROWSER_SCROLL_DESC from "./prompts/browser_scroll.txt?raw"
import BROWSER_HOVER_DESC from "./prompts/browser_hover.txt?raw"
import BROWSER_WAIT_DESC from "./prompts/browser_wait.txt?raw"
import BROWSER_EVAL_DESC from "./prompts/browser_eval.txt?raw"
import GENERATE_IMAGE_DESC from "./prompts/generate_image.txt?raw"
import { editNotebook } from "./notebook"
import { startMonitor, stopMonitor, listMonitors } from "./monitor"
import { sendDesktopNotification } from "../notify"
import { resolveImageGen, generateImage } from "@/lib/image-gen"
import { writeBinaryFileSafe } from "@/lib/fs-safe"
import { useGeneratedImages } from "@/store/generated-images"
import { emitMonitor } from "../monitor-bus"
import { emitSessionMessage } from "../session-message-bus"
import { resolveHandle, listPeers, handleTaken, normHandle, rateOk } from "../session-inbox"
import {
  browserNavigate,
  browserScreenshot,
  browserConsole,
  browserNetwork,
  pendingScreenshots,
  browserSnapshot,
  browserClick,
  browserFill,
  browserSelect,
  browserPress,
  browserType,
  browserScroll,
  browserHover,
  browserWait,
  browserEval,
} from "../browser"
import { usePreviewStore } from "@/store/preview"
import { useBrowserShots } from "@/store/browser-shots"
import { useWriteDiffs } from "@/store/write-diffs"
import { redactInjectionAttempts } from "./web"
import {
  readWorkspaceRoutines,
  readUserRoutines,
  writeRoutine,
  deleteRoutine,
} from "../routines"
import { parseCron, nextFireAt, validateCron, parseDelayMinutes, delayToCron } from "../cron"
import { refreshScheduler } from "../routine-scheduler"
import {
  createWorktree as createWorktreeImpl,
  listWorktrees as listWorktreesImpl,
  removeWorktree as removeWorktreeImpl,
  findRepoRoot,
} from "./worktree"
import {
  resolveRepo,
  getGithubToken,
  createPullRequest,
  GithubApiError,
} from "@/lib/github"
import { gitStatus, gitDefaultBranch, gitPublish } from "@/lib/git"
import { errorMessage } from "@/lib/errors"
import { useApprovalsStore } from "@/store/approvals"
import { useQuestionsStore, NO_ANSWER } from "@/store/questions"
import { loadSkillByName, listSkillFiles, refreshMcpSkills } from "../skills"
import {
  findAgent,
  checkSubagentPolicy,
  readWorkspaceAgents,
  readUserAgents,
  type SubagentPolicy,
} from "../agents"
import {
  buildLanguageModel,
  parseStreamError,
  isRetryableError,
  retryDelayMs,
  type ProviderId,
} from "../providers"
import { makeToolCallRepair } from "../tool-repair"
import { beatTool, beginToolActivity, endToolActivity } from "../tool-heartbeat"
import type { WorkerEvent, AgentCardPart } from "../orchestra/types"
import { useSettingsStore } from "@/store/settings"
import { getEffectiveSettings } from "@/lib/config"
import { attachNestedMemory } from "@/lib/memory-attach"
import { appendMemory } from "@/lib/memory-write"
import { saveMethod } from "@/lib/methods"
import { useSessionsStore } from "@/store/sessions"
import { db } from "@/lib/db"
import { ensureHistorySchema, getThreadMessages, searchThreads } from "@/lib/harness-history/store"
import { useJobsStore, DEFAULT_WAIT_MS, type BackgroundJob } from "@/store/jobs"
import { useWorkflowsStore, WF_DEFAULT_WAIT_MS, type WorkflowRun } from "@/store/workflows"
import { recordToolCall } from "@/store/tool-telemetry"
import { estimateTextTokens } from "@/lib/tokens"
import { buildMcpTools, listPluginMcps, listConnectedMcpResources, readMcpResource } from "../mcp"
import { listPluginHooks } from "../hooks"
import { createId } from "@/lib/id"
import type { Message, Settings } from "@/store/types"
import { isAbsolutePath, resolveInWorkspace, WorkspaceError } from "./paths"
import { withLock } from "../lock"
import {
  lspHover,
  lspDefinition,
  lspReferences,
  lspImplementation,
  lspDocumentSymbol,
  lspWorkspaceSymbol,
  lspPrepareCallHierarchy,
  lspIncomingCalls,
  lspOutgoingCalls,
  lspDiagnostics,
} from "../lsp"
import type { LspDiagnostic } from "../lsp"
import { listPluginAgents } from "../agents/plugin"
import { checkpoint } from "../snapshots"
import { scanToolInput, secretDenyGuidance, redactSecrets } from "@/lib/security/scan"
import { runHooks } from "../hooks"
import { loadIndex, queryIndex, indexDocs } from "../semantic-index"
import { formatSymbol } from "../token-savers"
import type { CodeSymbol } from "../token-savers"
import { invoke } from "@tauri-apps/api/core"

const READ_ONLY = new Set(["list_dir", "read_file", "load_skill", "question", "lsp", "tool_search"])

// Format LSP diagnostics for the AI tool: "SEVERITY [line:col] [code] message".
// LSP positions are 0-based; we display them 1-based to match editors.
function formatDiagnostics(diags: LspDiagnostic[]): string {
  if (!diags.length) return "No diagnostics."
  const sev = (s?: number) => (s === 1 ? "ERROR" : s === 2 ? "WARN" : s === 3 ? "INFO" : "HINT")
  return diags
    .map((d) => {
      const { line, character } = d.range.start
      const code = d.code != null ? ` [${d.code}]` : ""
      return `${sev(d.severity)} [${line + 1}:${character + 1}]${code} ${d.message}`
    })
    .join("\n")
}

function lspResultString(
  res: { available: boolean; reason?: string; data?: unknown },
  operation: string,
): string {
  if (!res.available) return `LSP unavailable: ${res.reason}`
  if (res.data == null) return "(no result)"
  if (Array.isArray(res.data)) {
    if (res.data.length === 0) return `No results found for ${operation}`
    const CAP = 100
    if (res.data.length > CAP) {
      return (
        JSON.stringify(res.data.slice(0, CAP), null, 2) +
        `\n\n(Showing the first ${CAP} of ${res.data.length} results; use a narrower query.)`
      )
    }
  }
  return JSON.stringify(res.data, null, 2)
}

const GREP_LIMIT = 100
function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matches"
  const truncated = hits.length > GREP_LIMIT
  const shown = truncated ? hits.slice(0, GREP_LIMIT) : hits
  const out = [`${hits.length} match${hits.length === 1 ? "" : "es"} found${truncated ? ` (showing first ${GREP_LIMIT})` : ""}`]
  let current = ""
  for (const h of shown) {
    if (current !== h.rel) {
      if (current !== "") out.push("")
      current = h.rel
      out.push(`${h.rel}:`)
    }
    out.push(`  Line ${h.line}: ${h.text}`)
  }
  if (truncated) {
    out.push("")
    out.push(`(Results truncated: showing first ${GREP_LIMIT} of ${hits.length} matches. Use a narrower pattern or path.)`)
  }
  return out.join("\n")
}

const SPAWN_OUTPUT_MAX = 8000
const WORKER_OUTPUT_MAX = 6000

const AGENT_STALL_MS = 150_000
const AGENT_DEADLINE_MS = 600_000
const AGENT_WD_CHECK_MS = 5_000 // watchdog tick
const MAX_SUBAGENT_RETRIES = 2
const AGENT_SUMMARY_TIMEOUT_MS = 60_000

function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return sliceCharsSafe(text, maxChars) + `\n\n[... truncated, ${text.length} total chars]`
}

function formatJobOutput(job: BackgroundJob, cursor?: number): string {
  const head =
    `[${job.status}` +
    (job.exitCode != null ? ` exit=${job.exitCode}` : "") +
    `] ${job.command}`
  const firstAbs = job.emitted - job.output.length
  let lines: string[]
  let gap = 0
  if (cursor == null) {
    lines = job.output.slice(-100)
  } else if (cursor >= job.emitted) {
    lines = []
  } else if (cursor < firstAbs) {
    lines = job.output.slice()
    gap = firstAbs - cursor
  } else {
    lines = job.output.slice(cursor - firstAbs)
  }
  const body = lines.length
    ? lines.join("\n")
    : cursor != null
      ? "(no new output)"
      : "(no output)"
  const note = gap > 0 ? `\n[note: ${gap} lines fell out of the ring buffer]` : ""
  return `${head}\ncursor=${job.emitted}${note}\n${body}`
}

async function appendFormatters(
  workspace: string,
  path: string,
  result: string,
): Promise<string> {
  if (!autoFormatEnabled(workspace)) return result
  const surfaced = await runFormatters(workspace, path)
  return surfaced ? `${result}\n\n${surfaced}` : result
}

function autoFormatEnabled(workspace: string | undefined): boolean {
  const s = getEffectiveSettings(workspace)
  return s.autoLintOnEdit === true && s.approvalMode === "bypass"
}

const doomHistory = new Map<string, string[]>()

export function resetDoomLoop(ownerSessionId: string): void {
  doomHistory.delete(ownerSessionId || "default")
}

function isDoomTracked(tool: string): boolean {
  return (
    !READ_ONLY.has(tool) &&
    !READ_ONLY_EXTRA.has(tool) &&
    !tool.startsWith("browser_") &&
    !isMcpToolName(tool)
  )
}

function recordDoomAndWarn(tool: string, input: unknown, ownerSessionId: string): string | null {
  const sid = ownerSessionId || "default"
  const key = `${tool}:${JSON.stringify(input)}`
  const hist = doomHistory.get(sid) ?? []
  const repeat = isDoomRepeat(hist, key)
  hist.push(key)
  if (hist.length > DOOM_WINDOW) hist.shift()
  doomHistory.set(sid, hist)
  if (!repeat) return null
  return (
    `Warning: doom-loop detected. '${tool}' was called ${DOOM_REPEAT} times in a row with the same arguments and unchanged output. ` +
    `You are likely stuck; do not repeat the same call. Inspect the root cause (for example wrong working directory, bad arguments, missing dependency) and try a different approach.`
  )
}

const PLAN_BLOCKED = new Set(["write_file", "edit_file", "bash", "apply_patch", "notebook_edit", "monitor", "remember", "save_method", "run_workflow", "send_to_session"])

const READ_ONLY_EXTRA = new Set([
  "repo_overview",
  "list_worktrees",
  "grep",
  "glob",
  "todo_write",
  "bash_status",
  "code_query",
  "code_search",
  "code_callers",
  "code_callees",
  "code_trace",
  "code_impact",
  "code_context",
  "workflow_status",
])

function wrapToolsWithPolicy(
  tools: ToolSet,
  policy: SubagentPolicy,
  ownerSessionId: string,
): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const original = t as { execute?: (args: unknown, ctx: unknown) => Promise<unknown> }
    if (!original.execute) {
      out[name] = t
      continue
    }
    out[name] = {
      ...t,
      execute: async (args: unknown, ctx: unknown) => {
        const check = checkSubagentPolicy(policy, name, args)
        if (!check.allowed) {
          throw new Error(check.reason ?? `Subagent cannot use '${name}'`)
        }
        if (check.requiresApproval) {
          const decision = await useApprovalsStore
            .getState()
            .request(name, args, { sessionId: ownerSessionId })
          if (decision === "deny") {
            throw new Error(`The user denied subagent call '${name}'`)
          }
        }
        return original.execute!(args, ctx)
      },
    } as ToolSet[string]
  }
  return out
}

async function gate(
  tool: string,
  input: unknown,
  ownerSessionId: string,
  workspace?: string,
): Promise<unknown> {
  const mode = useSessionsStore.getState().sessions[ownerSessionId]?.mode ?? "build"
  if (mode === "plan" && PLAN_BLOCKED.has(tool)) {
    throw new Error(
      `Cannot call '${tool}' in plan mode: this mode is read-only (read_file, list_dir, grep, webfetch, question). Switch to build mode (⌘M) or suggest an alternative approach.`,
    )
  }
  // Effective hooks = global + active workspace's project config (warmed by the
  // send/stream entry point); plugin-contributed hooks appended.
  const settingsHooks = getEffectiveSettings(workspace).hooks ?? []
  const hooks = [...settingsHooks, ...listPluginHooks()]
  let modifiedInput: unknown
  if (hooks.length > 0) {
    const r = await runHooks({
      hooks,
      event: "PreToolUse",
      toolName: tool,
      payload: { tool, input },
      workspace,
    })
    if (r.blocked) {
      throw new Error(`Blocked by hook: ${r.blockReason ?? "(no reason)"}`)
    }
    if (r.modifiedInput !== undefined) {
      modifiedInput = r.modifiedInput
      input = r.modifiedInput
    }
  }
  if (READ_ONLY.has(tool) || READ_ONLY_EXTRA.has(tool)) return modifiedInput
  if (hooks.length > 0) {
    const pr = await runHooks({
      hooks,
      event: "PermissionRequest",
      toolName: tool,
      payload: { tool, input },
      workspace,
    })
    if (pr.blocked) {
      throw new Error(`Permission denied by hook: ${pr.blockReason ?? "(no reason)"}`)
    }
    if (pr.autoApprove) {
      await captureCheckpoint(ownerSessionId, workspace)
      return modifiedInput
    }
  }
  const decision = await useApprovalsStore.getState().request(tool, input, { sessionId: ownerSessionId })
  if (decision === "deny") {
    // If the denial was over credential-grade secrets, hand the model an
    // actionable fix instruction (switch to an env var) so it self-corrects and
    // retries — instead of a generic rejection it would just give up on.
    const findings =
      getEffectiveSettings(workspace).securityScan !== false ? scanToolInput(tool, input) : []
    throw new Error(secretDenyGuidance(findings) ?? `The user denied '${tool}'`)
  }
  await captureCheckpoint(ownerSessionId, workspace)
  return modifiedInput
}

async function postHook(
  tool: string,
  input: unknown,
  output: string,
  workspace: string | undefined,
  isError = false,
): Promise<void> {
  // Effective hooks = global + active workspace's project config (warmed by the
  // send/stream entry point); plugin-contributed hooks appended.
  const settingsHooks = getEffectiveSettings(workspace).hooks ?? []
  const hooks = [...settingsHooks, ...listPluginHooks()]
  if (hooks.length === 0) return
  try {
    await runHooks({
      hooks,
      event: "PostToolUse",
      toolName: tool,
      payload: { tool, input, output, isError },
      workspace,
    })
  } catch (e) {
    console.warn("[postHook] error:", e)
  }
}

async function captureCheckpoint(ownerSessionId: string, workspace: string | undefined): Promise<void> {
  if (!workspace) return
  const store = useSessionsStore.getState()
  const session = store.sessions[ownerSessionId]
  if (!session) return
  const pendingMsg = [...session.messages].reverse().find((m) => m.role === "assistant" && m.pending)
  if (!pendingMsg || pendingMsg.snapshotBase) return
  try {
    const base = await checkpoint(ownerSessionId, workspace)
    if (base) store.setSnapshotBaseFor(ownerSessionId, pendingMsg.id, base)
  } catch (e) {
    console.warn("[snapshot] checkpoint failed:", e)
  }
}

async function resolvePathOrAsk(workspace: string, rel: string, toolName: string): Promise<string> {
  try {
    return resolveInWorkspace(workspace, rel)
  } catch (e) {
    if (!(e instanceof WorkspaceError)) throw e
    if (!isAbsolutePath(rel)) throw e
    const decision = await useApprovalsStore.getState().request("external_file_access", {
      tool: toolName,
      path: rel,
    })
    if (decision === "deny") throw new Error(`Access outside the workspace was denied: ${rel}`, { cause: e })
    return rel
  }
}

export type ToolName =
  | "list_dir"
  | "read_file"
  | "read_summary"
  | "write_file"
  | "edit_file"
  | "bash"
  | "question"
  | "webfetch"
  | "websearch"
  | "firecrawl"
  | "repo_overview"
  | "apply_patch"
  | "clone_repo"
  | "create_worktree"
  | "list_worktrees"
  | "remove_worktree"
  | "create_pr"
  | "index_docs"
  | "code_query"
  | "code_search"
  | "code_callers"
  | "code_callees"
  | "code_trace"
  | "code_impact"
  | "code_context"
  | "grep"
  | "glob"
  | "todo_write"
  | "bash_status"
  | "load_skill"
  | "spawn_agent"
  | "delegate_agents"
  | "dispatch_workers"
  | "merge_workers"
  | "run_workflow"
  | "workflow_status"
  | "propose_build"
  | "propose_plan"
  | "notebook_edit"
  | "notify"
  | "schedule_task"
  | "monitor"
  | "remember"
  | "save_method"
  | "tool_search"

function wrapWithPostHook(
  tools: ToolSet,
  workspace: string | undefined,
  ownerSessionId: string,
): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const orig = t as { execute?: (args: unknown, ctx: unknown) => Promise<unknown> }
    if (!orig.execute) {
      out[name] = t
      continue
    }
    out[name] = {
      ...t,
      execute: async (args: unknown, ctx: unknown) => {
        let output: unknown
        let err: unknown
        const t0 = performance.now()
        try {
          output = await orig.execute!(args, ctx)
          if (isDoomTracked(name)) {
            const warn = recordDoomAndWarn(name, args, ownerSessionId)
            if (warn && typeof output === "string") output = `${output}\n\n${warn}`
          }
          return output
        } catch (e) {
          err = e
          throw e
        } finally {
          const str =
            err != null
              ? err instanceof Error
                ? err.message
                : String(err)
              : typeof output === "string"
                ? output
                : JSON.stringify(output ?? "")
          recordToolCall(name, performance.now() - t0, estimateTextTokens(str), err != null)
          void postHook(name, args, str, workspace, err != null)
        }
      },
    } as ToolSet[string]
  }
  return out
}

function snapshotText(json: string): string {
  try {
    const s = JSON.parse(json) as {
      title?: string
      url?: string
      count?: number
      elements?: string[]
      error?: string
    }
    if (s.error) return `snapshot error: ${s.error}`
    const head = `${s.title ?? ""} — ${s.url ?? ""} (${s.count ?? 0} interactive elements)`
    return redactInjectionAttempts(`${head}\n${(s.elements ?? []).join("\n")}`).text
  } catch {
    return redactInjectionAttempts(json).text
  }
}

function summaryText(json: string): string {
  try {
    const s = JSON.parse(json) as { title?: string; url?: string; count?: number; error?: string }
    if (s.error) return `Done (snapshot error: ${s.error})`
    return redactInjectionAttempts(
      `${s.title ?? ""} — ${s.url ?? ""} (${s.count ?? 0} interactive elements). Call browser_snapshot to list them.`,
    ).text
  } catch {
    return "Done."
  }
}

function browserToolSet(ownerSessionId: string): ToolSet {
  return {
    browser_navigate: tool({
      description: BROWSER_NAVIGATE_DESC,
      inputSchema: z.object({
        url: z.string().describe("Absolute URL to open, e.g. http://localhost:5173"),
      }),
      execute: async ({ url }) => {
        if (!/^https?:\/\//i.test(url)) {
          return "Error: only http:// or https:// URLs can be opened (file://, chrome://, data:// are blocked)."
        }
        const r = await browserNavigate(ownerSessionId, url)
        const ws = useSessionsStore.getState().sessions[ownerSessionId]?.workspacePath ?? ""
        usePreviewStore.getState().recordNavigation(ws, r.finalUrl)
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("codezal:preview-navigate", { detail: { sessionId: ownerSessionId } }),
          )
        }
        const title = redactInjectionAttempts(r.title || "").text
        return `Navigated to ${r.finalUrl}\nTitle: ${title}`
      },
    }),
    browser_screenshot: tool({
      description: BROWSER_SCREENSHOT_DESC,
      inputSchema: z.object({}),
      execute: async (_args, { toolCallId }) => {
        const b64 = await browserScreenshot(ownerSessionId)
        // Injects as a USER-message image. Keep pending tool-result images bounded.
        if (pendingScreenshots.size >= 16) {
          const oldest = pendingScreenshots.keys().next().value
          if (oldest !== undefined) pendingScreenshots.delete(oldest)
        }
        pendingScreenshots.set(toolCallId, b64)
        useBrowserShots.getState().add(toolCallId, `data:image/jpeg;base64,${b64}`)
        return "Screenshot captured — delivered as an image in the next message."
      },
    }),
    browser_read_console: tool({
      description: BROWSER_CONSOLE_DESC,
      inputSchema: z.object({}),
      execute: async () => {
        const logs = await browserConsole(ownerSessionId)
        if (!logs.length) return "Console is empty (page not loaded yet, or no output)."
        return redactSecrets(redactInjectionAttempts(logs.join("\n")).text)
      },
    }),
    browser_read_network: tool({
      description: BROWSER_NETWORK_DESC,
      inputSchema: z.object({}),
      execute: async () => {
        const reqs = await browserNetwork(ownerSessionId)
        if (!reqs.length)
          return "No network requests captured yet (capture starts after browser_navigate; reload to record requests)."
        // maskele (injection-redaction'a ek olarak).
        return redactSecrets(redactInjectionAttempts(reqs.join("\n")).text)
      },
    }),
    browser_snapshot: tool({
      description: BROWSER_SNAPSHOT_DESC,
      inputSchema: z.object({}),
      execute: async () => snapshotText(await browserSnapshot(ownerSessionId)),
    }),
    browser_click: tool({
      description: BROWSER_CLICK_DESC,
      inputSchema: z.object({
        target: z.string().describe("Ref number from browser_snapshot, or a CSS selector"),
      }),
      execute: async ({ target }) => {
        await browserClick(ownerSessionId, target)
        await new Promise((r) => setTimeout(r, 350))
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_fill: tool({
      description: BROWSER_FILL_DESC,
      inputSchema: z.object({
        target: z.string().describe("Ref number from browser_snapshot, or a CSS selector"),
        text: z.string().describe("Value to type into the field"),
      }),
      execute: async ({ target, text }) => {
        await browserFill(ownerSessionId, target, text)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_select: tool({
      description: BROWSER_SELECT_DESC,
      inputSchema: z.object({
        target: z.string().describe("Ref number or CSS selector of the <select>"),
        value: z.string().describe("Option value (or visible text)"),
      }),
      execute: async ({ target, value }) => {
        await browserSelect(ownerSessionId, target, value)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_press: tool({
      description: BROWSER_PRESS_DESC,
      inputSchema: z.object({
        key: z.string().describe('Key name, e.g. "Enter", "Tab", "Escape", "ArrowDown"'),
      }),
      execute: async ({ key }) => {
        await browserPress(ownerSessionId, key)
        await new Promise((r) => setTimeout(r, 350))
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_type: tool({
      description: BROWSER_TYPE_DESC,
      inputSchema: z.object({ text: z.string().describe("Text to type into the focused element") }),
      execute: async ({ text }) => {
        await browserType(ownerSessionId, text)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_scroll: tool({
      description: BROWSER_SCROLL_DESC,
      inputSchema: z.object({
        target: z.string().optional().describe("Ref/selector to scroll into view (omit to scroll window)"),
        dy: z.number().optional().describe("Window scroll delta in px (default 600, negative = up)"),
      }),
      execute: async ({ target, dy }) => {
        await browserScroll(ownerSessionId, target, dy)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_hover: tool({
      description: BROWSER_HOVER_DESC,
      inputSchema: z.object({
        target: z.string().describe("Ref number from browser_snapshot, or a CSS selector"),
      }),
      execute: async ({ target }) => {
        await browserHover(ownerSessionId, target)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_wait: tool({
      description: BROWSER_WAIT_DESC,
      inputSchema: z.object({
        selector: z.string().describe("CSS selector to wait for"),
        timeoutMs: z.number().optional().describe("Max wait in ms (default 5000)"),
      }),
      execute: async ({ selector, timeoutMs }) => {
        await browserWait(ownerSessionId, selector, timeoutMs ?? 5000)
        return summaryText(await browserSnapshot(ownerSessionId))
      },
    }),
    browser_eval: tool({
      description: BROWSER_EVAL_DESC,
      inputSchema: z.object({
        js: z.string().describe("JavaScript to run in the page; return a JSON-serializable value"),
      }),
      execute: async ({ js }) => {
        await gate("browser_eval", { js }, ownerSessionId)
        const result = await browserEval(ownerSessionId, js)
        return redactInjectionAttempts(`Result: ${result}`).text
      },
    }),
  }
}

export const READONLY_ALLOW = new Set<string>([
  "read_file", "read_summary", "list_dir", "grep", "glob",
  "lsp", "code_query", "code_search", "code_callers", "code_callees", "code_trace", "code_impact", "code_context",
  "repo_overview", "load_skill",
  "webfetch", "websearch", "firecrawl",
  "question", "notify", "todo_write", "propose_plan", "propose_build",
  // MCP plumbing
  "mcp_resource", "tool_search",
])

function imageGenConfigured(settings: Settings): boolean {
  const c = settings.imageGeneration
  if (!c?.enabled || !c.model?.trim()) return false
  const isCustom = !c.providerId || c.providerId === "custom"
  if (isCustom) return Boolean(c.baseUrl?.trim() && c.apiKey?.trim())
  return Boolean(c.providerId)
}

export async function buildAllTools(
  workspace: string | undefined,
  mcpServers: Parameters<typeof buildMcpTools>[0] = [],
  ownerSessionId: string,
  configWorkspace: string | undefined = workspace,
  maxReadChars?: number,
  readChunkLimit?: number,
): Promise<ToolSet> {
  const local = buildTools(workspace, ownerSessionId, configWorkspace, maxReadChars, readChunkLimit)
  const merged: ToolSet = { ...local }
  if (!useSettingsStore.getState().settings.firecrawl?.apiKey) delete merged.firecrawl
  if (!imageGenConfigured(useSettingsStore.getState().settings)) delete merged.generate_image
  Object.assign(merged, browserToolSet(ownerSessionId))
  merged.search_harness_history = tool({
    description:
      "Search and read your indexed past conversations from other AI coding tools " +
      "(Claude Code, Codex, opencode, Cursor). Use to recall earlier work, e.g. " +
      "'find the thread where we implemented X'. Pass `query` to search, or `threadId` " +
      "(from a result) to read that thread's full messages. Data is local and read-only.",
    inputSchema: z.object({
      query: z.string().optional().describe("Keywords to search across past threads"),
      threadId: z
        .string()
        .optional()
        .describe("Read a specific thread's full messages (from a prior result)"),
      harness: z
        .enum(["claude-code", "codex", "opencode", "cursor"])
        .optional()
        .describe("Limit results to one tool"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 15)"),
    }),
    execute: async ({ query, threadId, harness, limit }) => {
      await ensureHistorySchema(db)
      if (threadId) {
        const msgs = await getThreadMessages(db, threadId)
        if (msgs.length === 0) return `No thread found for id: ${threadId}`
        const body = msgs.map((m) => `${m.role}: ${m.text}`).join("\n\n")
        return body.length > 20000 ? body.slice(0, 20000) + "\n\n[... truncated]" : body
      }
      if (!query || !query.trim()) {
        return "Provide `query` to search, or `threadId` to read a thread."
      }
      const hits = await searchThreads(db, query, { limit: limit ?? 15, harness })
      if (hits.length === 0) {
        return "No matching threads. If you haven't indexed yet, open Settings → History and run a scan."
      }
      return hits
        .map(
          (h) =>
            `[${h.harness}] ${h.title}${h.projectPath ? ` — ${h.projectPath}` : ""}\n` +
            `  ${h.snippet}\n  threadId: ${h.threadId}`,
        )
        .join("\n\n")
    },
  })
  merged.send_to_session = tool({
    description: SEND_TO_SESSION_DESC,
    inputSchema: z.object({
      to: z.string().describe("Target session handle, e.g. 'cto' (leading '@' optional)"),
      message: z.string().min(1).describe("Self-contained message to deliver to that session"),
    }),
    execute: async ({ to, message }) => {
      const store = useSessionsStore.getState()
      const metas = store.index
      const toSid = resolveHandle(metas, to, ownerSessionId)
      if (!toSid) {
        const peers = listPeers(metas, ownerSessionId)
        return peers.length
          ? `No session has handle "${to}". Available: ${peers.map((p) => `@${p.handle} (${p.title})`).join(", ")}.`
          : `No session has handle "${to}", and no peer sessions have handles yet. Have the target run set_session_handle first.`
      }
      if (toSid === ownerSessionId) return "Cannot send a message to yourself."
      const toMeta = metas.find((m) => m.id === toSid)
      const tag = `@${toMeta?.handle ?? to}`
      if (!rateOk(ownerSessionId, toSid, Date.now())) {
        return `Rate limit: too many messages to ${tag} in the last minute. Wait before retrying.`
      }
      await gate("send_to_session", { to, message }, ownerSessionId)
      const selfMeta = metas.find((m) => m.id === ownerSessionId)
      const fromLabel = selfMeta?.handle ? `@${selfMeta.handle}` : `"${selfMeta?.title ?? "another session"}"`
      emitSessionMessage({ toSessionId: toSid, fromLabel, text: message })
      return store.streamingIds[toSid]
        ? `Queued for ${tag} (${toMeta?.title ?? ""}) — it is busy; will be delivered when its current turn ends.`
        : `Delivered to ${tag} (${toMeta?.title ?? ""}) — it is waking now in the background.`
    },
  })
  merged.set_session_handle = tool({
    description: SET_SESSION_HANDLE_DESC,
    inputSchema: z.object({
      handle: z.string().describe("Short handle for THIS session, e.g. 'cto'. Empty string clears it."),
    }),
    execute: async ({ handle }) => {
      const store = useSessionsStore.getState()
      const raw = handle.trim()
      if (!raw) {
        store.setHandleFor(ownerSessionId, undefined)
        return "Handle cleared — other sessions can no longer address this session by handle."
      }
      const norm = normHandle(raw)
      if (!norm) {
        return `Invalid handle "${handle}". Use a single word: letters, digits, '-' or '_' (e.g. 'cto', 'build-lead').`
      }
      if (handleTaken(store.index, norm, ownerSessionId)) {
        return `Handle "@${norm}" is already used by another session. Pick a different one.`
      }
      store.setHandleFor(ownerSessionId, raw)
      return `This session's handle is now @${norm}. Other agents can reach it with send_to_session({ to: "${norm}", message }).`
    },
  })
  const allMcps = [...mcpServers, ...listPluginMcps()]
  if (allMcps.length > 0) {
    const { tools: mcp } = await buildMcpTools(allMcps)
    Object.assign(merged, mcp)
    await refreshMcpSkills(allMcps)
    merged.mcp_resource = tool({
      description: MCP_RESOURCE_DESC,
      inputSchema: z.object({
        action: z.enum(["list", "read"]).optional(),
        server: z.string().optional().describe("Server name (from list) — for read"),
        uri: z.string().optional().describe("Resource URI (from list) — for read"),
      }),
      execute: async ({ action, server, uri }) => {
        const act = action ?? "list"
        if (act === "list") {
          const groups = listConnectedMcpResources()
          if (!groups.length) return "No resources on connected MCP servers."
          return groups
            .map(
              (g) =>
                `## ${g.server}\n` +
                g.resources.map((r) => `- ${r.uri}${r.name ? ` (${r.name})` : ""}`).join("\n"),
            )
            .join("\n\n")
        }
        // read
        if (!uri) return "uri is required for read."
        const cfg = allMcps.find((m) => m.name === server)
        if (!cfg) return `MCP server not found: ${server}`
        const res = await readMcpResource(cfg, uri)
        const contents = (res.contents ?? []) as Array<{ text?: string; blob?: string }>
        const parts = contents
          .map((c) => c.text ?? (c.blob ? "(binary content)" : ""))
          .filter(Boolean)
        return parts.join("\n\n") || "(empty resource)"
      },
    })
  }
  const mode = useSessionsStore.getState().sessions[ownerSessionId]?.mode ?? "build"
  if (mode !== "orchestra") {
    delete merged.dispatch_workers
    delete merged.merge_workers
  }
  if (useSettingsStore.getState().settings.disableWorkflows === true) {
    delete merged.run_workflow
    delete merged.workflow_status
  }
  if (merged.spawn_agent) {
    try {
      const [proj, user] = await Promise.all([
        readWorkspaceAgents(configWorkspace),
        readUserAgents(),
      ])
      const pluginCount = listPluginAgents().length
      if (proj.length + user.length + pluginCount === 0) {
        delete merged.spawn_agent
      }
    } catch {
      delete merged.spawn_agent
    }
  }
  const supervisor =
    useSettingsStore.getState().settings.supervisor ??
    (await import("@/lib/agents/runtime/supervisor")).DEFAULT_SUPERVISOR_SETTINGS
  const delegationMode = useSessionsStore.getState().sessions[ownerSessionId]?.delegationMode ?? "solo"
  if (
    delegationMode === "solo" ||
    !supervisor.enabled ||
    !supervisor.pool.some((entry) => entry.enabled)
  ) {
    delete merged.delegate_agents
  }
  if (getEffectiveSettings(configWorkspace).memory?.autonomousRemember === false) {
    delete merged.remember
    delete merged.save_method
  }
  // dispatch/workflow/remember/notebook_edit/schedule/monitor gibi mutasyon/exec
  //
  // (write_file/edit_file/bash/apply_patch/monitor/remember/notebook_edit/schedule_task/
  // clone_repo/create_worktree/remove_worktree hepsi strip).
  //
  if (useSessionsStore.getState().sessions[ownerSessionId]?.workspaceReadOnly === true) {
    for (const k of Object.keys(merged)) {
      if (READONLY_ALLOW.has(k) || k.startsWith("browser_") || isMcpToolName(k)) continue
      delete merged[k]
    }
  }
  return wrapWithPostHook(merged, workspace, ownerSessionId)
}


export const TOOL_SEARCH_NAME = "tool_search"

// The lean "core" toolset sent to EVERY model up front (opencode/Cursor parity).
// Everything else is deferred and discovered via tool_search — keeps the request
// small, the model focused, and tool-calling reliable (a flat ~50-tool dump
// overwhelms small models and wastes tokens on large ones).
export const CORE_TOOL_NAMES = new Set<string>([
  "read_file",
  "read_summary",
  "write_file",
  "edit_file",
  "apply_patch",
  "bash",
  "bash_status",
  "list_dir",
  "grep",
  "glob",
  "repo_overview",
  "code_query",
  "code_search",
  "code_callers",
  "code_callees",
  "code_trace",
  "code_impact",
  "code_context",
  "load_skill",
  "todo_write",
  "question",
  "webfetch",
  "lsp",
])

export function isMcpToolName(name: string): boolean {
  return name.includes("__")
}

export function deferredToolNames(tools: ToolSet): string[] {
  return Object.keys(tools).filter((n) => n !== TOOL_SEARCH_NAME && !CORE_TOOL_NAMES.has(n))
}

// Model-tailored editing tools (opencode parity): GPT-5/codex-class models use
// apply_patch; everyone else (Claude, Gemini, gpt-4, local, …) uses edit_file +
// write_file. Sending only the right pair avoids redundant schemas + confusion.
export function applyModelToolPolicy(tools: ToolSet, modelId: string): void {
  const usePatch =
    modelId.includes("gpt-") && !modelId.includes("oss") && !modelId.includes("gpt-4")
  if (usePatch) {
    delete tools["edit_file"]
    delete tools["write_file"]
  } else {
    delete tools["apply_patch"]
  }
}

// `notebooklm-mcp__notebook_list` → ["notebooklm","mcp","notebook","list"].
function parseDeferredName(name: string): string[] {
  return name
    .toLowerCase()
    .split("__")
    .flatMap((p) => p.split(/[_-]/))
    .filter(Boolean)
}

function searchDeferred(query: string, deferred: string[], tools: ToolSet, maxResults: number): string[] {
  const q = query.toLowerCase().trim()
  const exact = deferred.find((n) => n.toLowerCase() === q)
  if (exact) return [exact]
  if (q.includes("__")) {
    const pre = deferred.filter((n) => n.toLowerCase().startsWith(q)).slice(0, maxResults)
    if (pre.length) return pre
  }
  const terms = q.split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored = deferred.map((name) => {
    const parts = parseDeferredName(name)
    const desc = String(tools[name]?.description ?? "").toLowerCase()
    let score = 0
    for (const t of terms) {
      if (parts.includes(t)) score += 10
      else if (parts.some((p) => p.includes(t))) score += 5
      if (desc.includes(t)) score += 2
    }
    return { name, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.name)
}

const TOOL_SEARCH_DESC =
  "Load the input schemas of deferred tools so they can be called. Connected MCP tools are " +
  "listed by name in the system prompt but their schemas are NOT loaded — to save tokens. " +
  "Use this tool first to load the ones you need; the matched tools become callable on the next step.\n" +
  'Query forms:\n' +
  '- "select:server__toolName" — load these exact tools by name (comma-separate several)\n' +
  '- "keywords" — search by capability across tool names and descriptions (e.g. "notebook list")'

export function makeToolSearchTool(tools: ToolSet, deferred: string[], activeSet: Set<string>): ToolSet[string] {
  return tool({
    description: TOOL_SEARCH_DESC,
    inputSchema: z.object({
      query: z
        .string()
        .describe('"select:server__tool" for exact load (comma-separated for several), or keywords to search'),
      max_results: z.number().int().min(1).max(25).optional().describe("Maximum results for keyword search (default 8)"),
    }),
    execute: async ({ query, max_results }) => {
      const max = max_results ?? 8
      const sel = query.match(/^select:(.+)$/i)
      let matches: string[]
      if (sel) {
        const want = sel[1].split(",").map((s) => s.trim()).filter(Boolean)
        matches = want.filter((n) => deferred.includes(n))
      } else {
        matches = searchDeferred(query, deferred, tools, max)
      }
      if (matches.length === 0) {
        return `No matching deferred tools for "${query}". ${deferred.length} deferred tools available — try different keywords or use select:<name>.`
      }
      for (const n of matches) activeSet.add(n)
      const lines = matches.map((n) => {
        const desc = String(tools[n]?.description ?? "").split("\n")[0].slice(0, 120)
        return `- ${n}: ${desc}`
      })
      return `${matches.length} tool(s) loaded and now callable:\n${lines.join("\n")}\n\nNext step: call the selected tool now. Do not stop or describe that you will call it.`
    },
  })
}

function buildWebTools(ownerSessionId: string): ToolSet {
  const gateFor = (tool: string, input: unknown) => gate(tool, input, ownerSessionId)
  return {
    clone_repo: tool({
      description: REPO_CLONE_DESC,
      inputSchema: z.object({
        url: z.string().describe("Git URL — https / git@ / ssh"),
        target: z
          .string()
          .optional()
          .describe("Target absolute path. Defaults to ~/Documents/<repo-name>."),
        branch: z.string().optional().describe("Branch to check out after cloning"),
        depth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Shallow-clone depth (e.g. 1 = last commit only). Omit for full history."),
      }),
      execute: async ({ url, target, branch, depth }) => {
        await gateFor("clone_repo", { url, target, branch })
        const r = await cloneRepoImpl({ url, target, branch, depth })
        useSessionsStore.getState().updateMetaFor(ownerSessionId, { workspacePath: r.path })
        const lines = [
          `Cloned: ${r.repoName}`,
          `Path: ${r.path}`,
        ]
        if (r.branch) lines.push(`Active branch: ${r.branch}`)
        lines.push("Workspace attached automatically; subsequent tools run in this folder.")
        return lines.join("\n")
      },
    }),

    webfetch: tool({
      description: WEBFETCH_DESC,
      inputSchema: z.object({
        url: z.string().url().describe("The URL to fetch — http:// or https://"),
        format: z
          .enum(["markdown", "text", "html"])
          .optional()
          .describe("Return format: markdown (default), text, or html"),
      }),
      execute: async ({ url, format }) => {
        await gateFor("webfetch", { url })
        return webfetchImpl(url, format ?? "markdown")
      },
    }),

    firecrawl: tool({
      description:
        "Scrape a single web page via Firecrawl into clean, LLM-ready markdown. " +
        "Use instead of webfetch for JS-heavy/SPA pages, dynamic content, or anti-bot " +
        "sites where webfetch returns empty or garbled output. Requires a Firecrawl API key.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to scrape — http:// or https://"),
      }),
      execute: async ({ url }) => {
        await gateFor("firecrawl", { url })
        const cfg = useSettingsStore.getState().settings.firecrawl
        if (!cfg?.apiKey) {
          throw new Error(
            "Firecrawl is not configured. Add a Firecrawl API key in Settings > Web Search.",
          )
        }
        return firecrawlImpl(url, cfg.apiKey)
      },
    }),

    websearch: tool({
      description: WEBSEARCH_DESC.replace("{{year}}", String(new Date().getFullYear())),
      inputSchema: z.object({
        query: z.string().describe("Search query — clear, focused keywords"),
        max_results: z.number().int().min(1).max(10).optional().describe("Maximum number of results to return (1-10, default 5)"),
      }),
      execute: async ({ query, max_results }) => {
        await gateFor("websearch", { query })
        const cfg = useSettingsStore.getState().settings.webSearch
        return websearchImpl(query, cfg, max_results ?? 5)
      },
    }),

    question: tool({
      description: QUESTION_DESC,
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().describe("Question shown to the user — in the user's language, clear"),
              header: z
                .string()
                .max(30)
                .optional()
                .describe("Very short label (≤30 characters)"),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Option label (1-5 words)"),
                    description: z.string().optional().describe("Short explanation of the option"),
                    recommended: z
                      .boolean()
                      .optional()
                      .describe("Mark the suggested choice — shown first and highlighted"),
                  }),
                )
                .optional()
                .describe("Optional list of choices (2-6 items)"),
              multiple: z.boolean().optional().describe("Allow selecting more than one option"),
              custom: z
                .boolean()
                .optional()
                .describe("Also accept a free-text answer alongside the options (default: true)"),
            }),
          )
          .min(1)
          .describe("One or more questions — the user answers them in turn"),
      }),
      execute: async ({ questions }) => {
        const normalized = questions.map((q) => ({ ...q, custom: q.custom ?? true }))
        const answers = await useQuestionsStore.getState().ask(ownerSessionId, normalized)
        return questions
          .map((q, i) => {
            const a = answers[i] ?? []
            const head = q.header ? `[${q.header}] ` : ""
            return `${head}${q.question}\n-> ${a.join(", ") || "(no answer)"}`
          })
          .join("\n\n")
      },
    }),

    notify: tool({
      description: NOTIFY_DESC,
      inputSchema: z.object({
        title: z.string().describe("Short notification headline, in the user's language"),
        body: z.string().optional().describe("Optional one-line detail"),
      }),
      execute: async ({ title, body }) => {
        await gateFor("notify", { title, body })
        await sendDesktopNotification(title, body)
        return `Notification sent: ${title}`
      },
    }),
  }
}

function formatWorkflowRun(run: WorkflowRun): string {
  const lines: string[] = []
  let tokOut = 0
  for (const a of run.agents) tokOut += a.tokensOut ?? 0
  lines.push(
    `Workflow "${run.name}" [${run.status}] - ${run.agents.length} agents, ${run.phases.length} phases, ~${tokOut} output tokens`,
  )
  const phaseOrder = run.phases.map((p) => p.title)
  const grouped = new Map<string, typeof run.agents>()
  for (const a of run.agents) {
    const k = a.phase || "(no phase)"
    const arr = grouped.get(k) ?? []
    arr.push(a)
    grouped.set(k, arr)
  }
  const keys = [...new Set([...phaseOrder, ...grouped.keys()])]
  for (const k of keys) {
    const arr = grouped.get(k)
    if (!arr || arr.length === 0) continue
    const done = arr.filter((a) => a.status === "done").length
    const err = arr.filter((a) => a.status === "error").length
    const run_ = arr.filter((a) => a.status === "running" || a.status === "pending").length
    lines.push(`  ${k}: ${arr.length} agents (${done} done, ${run_} running, ${err} errors)`)
  }
  if (run.logLines.length > 0) {
    lines.push("--- log (last 5) ---")
    for (const l of run.logLines.slice(-5)) lines.push(`  ${l}`)
  }
  if (run.status === "done") {
    lines.push("--- RESULT ---")
    lines.push(truncateForContext(run.result ?? "(empty)", WORKER_OUTPUT_MAX))
  } else if (run.status === "error") {
    lines.push(`ERROR: ${run.error ?? "unknown"}`)
  } else if (run.status === "cancelled") {
    lines.push("Cancelled.")
  } else {
    lines.push("(still running; poll again with workflow_status)")
  }
  return lines.join("\n")
}

function formatWorkflowList(runs: WorkflowRun[]): string {
  if (runs.length === 0) return "No active or completed workflow runs."
  return runs
    .map((r) => `${r.runId} - "${r.name}" [${r.status}] · ${r.agents.length} agents`)
    .join("\n")
}

export function buildTools(
  workWorkspace: string | undefined,
  ownerSessionId: string,
  configWorkspace: string | undefined = workWorkspace,
  maxReadChars?: number,
  readChunkLimit?: number,
): ToolSet {
  if (!workWorkspace) return buildWebTools(ownerSessionId)
  const workspace = workWorkspace
  const gateFor = (tool: string, input: unknown) => gate(tool, input, ownerSessionId)

  return {
    list_dir: tool({
      description:
        "List a directory in the workspace. Directories first, then files " +
        "with size. Set recursive to walk subdirectories (depth-limited, " +
        "default 3). path is relative to the workspace root.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Workspace-relative directory. Empty means '.' = root"),
        recursive: z
          .boolean()
          .optional()
          .describe("Walk subdirectories as an indented tree"),
        depth: z
          .number()
          .optional()
          .describe("Max depth when recursive (default 3)"),
      }),
      execute: async ({ path, recursive, depth }) => {
        const abs = await resolvePathOrAsk(workspace, path || ".", "list_dir")
        return listDirAbs(abs, recursive, depth)
      },
    }),

    read_file: tool({
      description: READ_DESC,
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        offset: z
          .number()
          .optional()
          .describe("1-based start line to read from"),
        limit: z.number().optional().describe("Max lines to read (default 2000)"),
      }),
      execute: async ({ path, offset, limit }) => {
        const abs = await resolvePathOrAsk(workspace, path, "read_file")
        const effLimit = limit ?? readChunkLimit
        const result = await readFileAbs(abs, offset, effLimit, maxReadChars)
        if (
          getEffectiveSettings(configWorkspace).memory?.dynamicAttach !== false &&
          !result.startsWith("data:")
        ) {
          const extra = await attachNestedMemory(workspace, abs, ownerSessionId)
          if (extra) return result + extra
        }
        return result
      },
    }),

    read_summary: tool({
      description:
        "Compact outline of a file — its functions/classes/types with line numbers (from the " +
        "Code Map), far smaller than the full text. Use this FIRST on a large file to see its " +
        "structure, then read_file with offset/limit on the part you need — avoids overflowing " +
        "the context window. Falls back to the file head when the file isn't indexed.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
      }),
      execute: async ({ path }) => {
        // Code-map workspace-rel path'i (forward slash) tutar → modelin path'ini rel'e indir.
        const ws = workspace.replace(/\\/g, "/").replace(/\/+$/, "")
        let rel = path.replace(/\\/g, "/")
        if (rel.startsWith(ws + "/")) rel = rel.slice(ws.length + 1)
        rel = rel.replace(/^\.?\//, "")
        try {
          const syms = await invoke<CodeSymbol[]>("codemap_file_symbols", { workspace, file: rel })
          if (syms.length > 0) {
            const body = syms
              .map((s) => `${s.line}\t${s.kind} ${s.name}${s.sig ? ` — ${s.sig}` : ""}`)
              .join("\n")
            return `${rel} — ${syms.length} symbols (outline; use read_file offset/limit for the body):\n${body}`
          }
        } catch {
          // Intentionally ignored.
        }
        const abs = await resolvePathOrAsk(workspace, path, "read_summary")
        const head = await readFileAbs(abs, 1, 80, maxReadChars)
        return `${rel} — no Code Map outline; first 80 lines (use read_file offset/limit for more):\n${head}`
      },
    }),

    grep: tool({
      description: GREP_DESC,
      inputSchema: z.object({
        query: z.string().describe("Text or regex to search for"),
        glob: z
          .string()
          .optional()
          .describe("Limit to files matching this glob, e.g. '*.ts'"),
        regex: z
          .boolean()
          .optional()
          .describe("Treat query as regex (default: fixed string)"),
        case_sensitive: z
          .boolean()
          .optional()
          .describe("Case-sensitive match (default: smart-case)"),
      }),
      execute: async ({ query, glob, regex, case_sensitive }) =>
        formatHits(
          await searchWorkspace(workspace, query, {
            glob,
            regex,
            caseSensitive: case_sensitive,
          }),
        ),
    }),

    glob: tool({
      description: GLOB_DESC,
      inputSchema: z.object({
        pattern: z
          .string()
          .describe("Glob pattern, e.g. 'src/**/*.tsx' or '*.md'"),
      }),
      execute: async ({ pattern }) => {
        const files = await globWorkspace(workspace, pattern)
        if (files.length === 0) return "No files found"
        const GLOB_LIMIT = 100
        const truncated = files.length > GLOB_LIMIT
        const shown = truncated ? files.slice(0, GLOB_LIMIT) : files
        let out = shown.join("\n")
        if (truncated) {
          out += `\n\n(Results truncated: showing first ${GLOB_LIMIT}. Use a narrower pattern or path.)`
        }
        return out
      },
    }),

    lsp: tool({
      description: LSP_DESC,
      inputSchema: z.object({
        operation: z.enum([
          "hover",
          "definition",
          "references",
          "implementation",
          "documentSymbol",
          "workspaceSymbol",
          "prepareCallHierarchy",
          "incomingCalls",
          "outgoingCalls",
          "diagnostics",
        ]),
        path: z.string().describe("Workspace-relative file path (anchor file for workspaceSymbol)"),
        line: z.number().int().min(1).optional().describe("1-based line (position-based operations)"),
        character: z.number().int().min(1).optional().describe("1-based column (position-based operations)"),
        query: z
          .string()
          .optional()
          .describe("Search query for workspaceSymbol (empty string = all symbols)"),
      }),
      execute: async ({ operation, path, line, character, query }) => {
        let abs: string
        try {
          abs = resolveInWorkspace(workspace ?? "", path)
        } catch (e) {
          return String(e)
        }
        const root = workspace ?? ""

        // Operations that do not require a position.
        if (operation === "diagnostics") {
          const res = await lspDiagnostics(root, abs)
          if (res.available) return formatDiagnostics(res.data)
          return `LSP unavailable: ${"reason" in res ? res.reason : "unknown"}`
        }
        if (operation === "documentSymbol") {
          return lspResultString(await lspDocumentSymbol(root, abs), operation)
        }
        if (operation === "workspaceSymbol") {
          return lspResultString(await lspWorkspaceSymbol(root, abs, query ?? ""), operation)
        }

        // Operations that require a position (hover/definition/references/implementation/callHierarchy).
        if (line === undefined || character === undefined) {
          return `'${operation}' requires line and character (1-based).`
        }
        const l = line - 1
        const c = character - 1

        const res =
          operation === "hover"
            ? await lspHover(root, abs, l, c)
            : operation === "definition"
              ? await lspDefinition(root, abs, l, c)
              : operation === "references"
                ? await lspReferences(root, abs, l, c)
                : operation === "implementation"
                  ? await lspImplementation(root, abs, l, c)
                  : operation === "prepareCallHierarchy"
                    ? await lspPrepareCallHierarchy(root, abs, l, c)
                    : operation === "incomingCalls"
                      ? await lspIncomingCalls(root, abs, l, c)
                      : await lspOutgoingCalls(root, abs, l, c)

        return lspResultString(res, operation)
      },
    }),

    write_file: tool({
      description: WRITE_DESC,
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        content: z.string().describe("Full contents of the file"),
      }),
      execute: async ({ path, content }, { toolCallId }) => {
        // PreToolUse hooks can rewrite path/content (modifiedInput); apply it.
        const mod = (await gateFor("write_file", { path, content })) as
          | { path?: string; content?: string }
          | undefined
        if (typeof mod?.path === "string") path = mod.path
        if (typeof mod?.content === "string") content = mod.content
        const abs = await resolvePathOrAsk(workspace, path, "write_file")
        const res = await withLock(abs, () =>
          writeFileAbs(abs, content, path, (old) => useWriteDiffs.getState().add(toolCallId, old)),
        )
        return appendFormatters(workspace, path, res)
      },
    }),

    edit_file: tool({
      description: EDIT_DESC,
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root"),
        old_string: z.string().describe("The exact text to replace"),
        new_string: z.string().describe("The replacement text (must differ from old_string)"),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence — for renaming a variable/string. Default false."),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        // PreToolUse hooks can rewrite input (modifiedInput); apply it.
        const mod = (await gateFor("edit_file", { path, old_string, new_string })) as
          | { path?: string; old_string?: string; new_string?: string }
          | undefined
        if (typeof mod?.path === "string") path = mod.path
        if (typeof mod?.old_string === "string") old_string = mod.old_string
        if (typeof mod?.new_string === "string") new_string = mod.new_string
        const abs = await resolvePathOrAsk(workspace, path, "edit_file")
        const res = await withLock(abs, () =>
          editFileAbs(abs, old_string, new_string, replace_all ?? false, path),
        )
        return appendFormatters(workspace, path, res)
      },
    }),

    // Sends the request to the configured image endpoint and saves the result under generated-images/.
    generate_image: tool({
      description: GENERATE_IMAGE_DESC,
      inputSchema: z.object({
        prompt: z.string().describe("Detailed description of the image to generate"),
        size: z
          .string()
          .optional()
          .describe('Image size "WxH" (e.g. "1024x1024") or "auto"'),
      }),
      execute: async ({ prompt, size }, { toolCallId }) => {
        const settings = useSettingsStore.getState().settings
        const r = await resolveImageGen(settings)
        if (!r.resolved) {
          return `Image generation unavailable: ${r.error}`
        }
        let img
        try {
          img = await generateImage(prompt, r.resolved, size)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return `Image generation failed: ${redactInjectionAttempts(msg).text}`
        }
        const comma = img.dataUrl.indexOf(",")
        const base64 = comma >= 0 ? img.dataUrl.slice(comma + 1) : img.dataUrl
        const sub = img.mime.split("/")[1]?.split(";")[0]?.toLowerCase() ?? ""
        const ext = /^[a-z0-9]{1,5}$/.test(sub) ? (sub === "jpeg" ? "jpg" : sub) : "png"
        const rel = `generated-images/${createId("image")}.${ext}`
        try {
          const abs = resolveInWorkspace(workspace, rel)
          await writeBinaryFileSafe(abs, base64)
        } catch (e) {
          return `Image generated but could not be saved: ${e instanceof Error ? e.message : String(e)}`
        }
        useGeneratedImages.getState().add(toolCallId, img.dataUrl)
        return `Image generated and saved to ${rel}. It is shown to the user.`
      },
    }),

    remember: tool({
      description: REMEMBER_DESC,
      inputSchema: z.object({
        text: z.string().describe("The durable fact or preference to remember (one concise sentence)"),
        scope: z
          .enum(["project", "global"])
          .describe("project → this workspace's learned-memory database; global → the user's global learned-memory database"),
        category: z
          .string()
          .optional()
          .describe("Optional section heading to group the note under (e.g. 'Conventions')"),
      }),
      execute: async ({ text, scope, category }) => {
        await gateFor("remember", { text, scope, category })
        const path = await appendMemory(scope, text, configWorkspace, category, "remember_tool")
        return `Added to memory (${scope === "project" ? "project" : "global"}): ${path}`
      },
    }),

    save_method: tool({
      description:
        "Save a reusable, multi-step workflow you just completed so it can be auto-recalled for similar future tasks. " +
        "Use AFTER finishing a non-trivial task whose recipe would help next time. Keep steps concise and generalizable.",
      inputSchema: z.object({
        name: z.string().describe("Short kebab/Title name for the method (e.g. 'add-zod-validated-setting')"),
        description: z.string().describe("When to use this method — the situation it applies to (one or two sentences)"),
        steps: z.array(z.string()).describe("Ordered, concise steps to follow"),
        triggers: z.array(z.string()).optional().describe("Optional keywords that hint when this applies"),
        scope: z
          .enum(["project", "global"])
          .describe("project → this workspace's .codezal/methods.json; global → ~/.codezal/methods.json"),
      }),
      execute: async ({ name, description, steps, triggers, scope }) => {
        await gateFor("save_method", { name, scope })
        const path = await saveMethod({ scope, name, description, steps, triggers, workspace: configWorkspace })
        return `Method saved (${scope === "project" ? "project" : "global"}): ${name} -> ${path}`
      },
    }),

    bash: tool({
      description: BASH_DESC,
      inputSchema: z.object({
        command: z.string().describe("Single-line bash command (cd to the workspace is already done)"),
        description: z
          .string()
          .describe(
            "Short description of what the command does (5-10 words), shown as the UI title. " +
              "Write it in the user's language. E.g. 'ls' -> 'Listed folder', " +
              "'npm install' -> 'Installed dependencies', 'npm run dev' -> 'Started dev server'.",
          ),
        background: z
          .boolean()
          .optional()
          .describe("Start in the background (no timeout). Returns a jobId; read/terminate via bash_status."),
      }),
      execute: async ({ command, background }) => {
        const mod = (await gateFor("bash", { command })) as { command?: string } | undefined
        if (typeof mod?.command === "string") command = mod.command
        if (background) {
          const id = await useJobsStore.getState().start(workspace, command, ownerSessionId)
          return `Background job started (id: ${id}). Read output and status with bash_status({ id: "${id}" }).`
        }
        const compactOutput = useSettingsStore.getState().settings.tokenSavers?.compactOutput
        const out = await runBash(workspace, command, { compactOutput, sessionId: ownerSessionId })
        return maxReadChars ? truncateForContext(out, maxReadChars) : out
      },
    }),

    bash_status: tool({
      description: BASH_STATUS_DESC,
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe("jobId — required for read/wait/kill; omit for list/clear."),
        action: z
          .enum(["read", "wait", "kill", "list", "clear"])
          .optional()
          .describe("read (default) | wait | kill | list | clear"),
        cursor: z
          .number()
          .optional()
          .describe("read/wait: fetch lines after this index (the previous call's cursor value)."),
        timeoutMs: z
          .number()
          .optional()
          .describe(`wait: max wait in ms (default ${DEFAULT_WAIT_MS}). On timeout, returns a running snapshot.`),
      }),
      execute: async ({ id, action, cursor, timeoutMs }) => {
        const store = useJobsStore.getState()
        const act = action ?? "read"

        if (act === "list") {
          const jobs = store.list()
          if (!jobs.length) return "No background jobs."
          return jobs
            .map(
              (j) =>
                `${j.id} [${j.status}` +
                (j.exitCode != null ? ` exit=${j.exitCode}` : "") +
                `] ${j.command}`,
            )
            .join("\n")
        }
        if (act === "clear") {
          const n = store.clearFinished()
          return `Cleared ${n} finished jobs.`
        }
        if (!id) return "id is required for read/wait/kill."
        if (act === "kill") {
          await store.kill(id)
          return `Job terminated: ${id}`
        }

        let job = store.read(id)
        if (!job) return `Job not found: ${id}`
        if (act === "wait") {
          const finished = await store.wait(id, timeoutMs)
          job = finished ?? job
          if (job.status === "running") {
            return `${formatJobOutput(job, cursor)}\n[note: ${timeoutMs ?? DEFAULT_WAIT_MS}ms elapsed; still running]`
          }
        }
        return formatJobOutput(job, cursor)
      },
    }),

    ...buildWebTools(ownerSessionId),

    repo_overview: tool({
      description: REPO_OVERVIEW_DESC,
      inputSchema: z.object({}),
      execute: async () => {
        await gateFor("repo_overview", {})
        return repoOverviewImpl(workspace)
      },
    }),

    create_worktree: tool({
      description:
        "Create a new git worktree to work on a parallel branch in the same repo. " +
        "If baseRef is provided, create a new branch from that ref (-b). " +
        "Otherwise the branch must already exist and will be checked out. " +
        "If target is omitted, create '<repo>-wt-<branch>' next to the repo.",
      inputSchema: z.object({
        branch: z.string().describe("Branch name the worktree should check out"),
        baseRef: z
          .string()
          .optional()
          .describe("Base ref to use when creating a new branch (for example 'main', 'origin/dev')"),
        target: z.string().optional().describe("Target worktree path, absolute"),
      }),
      execute: async ({ branch, baseRef, target }) => {
        await gateFor("create_worktree", { branch, baseRef, target })
        const wt = await createWorktreeImpl({ repoPath: workspace, branch, baseRef, target })
        return [
          `Worktree created`,
          `Path: ${wt.path}`,
          `Branch: ${wt.branch ?? "(detached)"}`,
          `HEAD: ${wt.head}`,
          "",
          "Open a separate session and attach its workspace to this folder to work in this worktree.",
        ].join("\n")
      },
    }),

    ...buildCodeMapTools(configWorkspace),

    index_docs: tool({
      description: INDEX_DOCS_DESC,
      inputSchema: z.object({
        urls: z
          .array(z.string().url())
          .min(1)
          .max(20)
          .describe("HTTP(S) documentation URLs to index (1-20)"),
      }),
      execute: async ({ urls }) => {
        await gateFor("index_docs", { urls })
        const sem = useSettingsStore.getState().settings.semantic
        if (!sem?.enabled) {
          return "Semantic index is disabled. Enable it in Settings > Semantic and build the index."
        }
        const r = await indexDocs({
          workspace: configWorkspace ?? workspace,
          cfg: { provider: sem.provider, baseUrl: sem.baseUrl, model: sem.model, apiKey: sem.apiKey },
          urls,
          fetch: (u) => webfetchImpl(u, "markdown"),
        })
        return [
          `${r.added} chunks added (${r.urls.length}/${urls.length} URLs).`,
          r.urls.length ? `Indexed: ${r.urls.join(", ")}` : "",
          "code_query and per-turn auto-context can now retrieve these docs.",
        ]
          .filter(Boolean)
          .join("\n")
      },
    }),

    code_query: tool({
      description:
        "Run a natural-language query against the workspace semantic index. " +
        "Returns the most relevant code chunks by embedding similarity (path:line0-line1 + snippet). " +
        "If the index is missing or semantic search is disabled, it returns an error; the user must build the index in Settings > Semantic. " +
        "Use it for conceptual searches grep cannot handle (for example 'token refresh flow', 'user logout').",
      inputSchema: z.object({
        query: z.string().describe("Natural-language query, clear and concise"),
        top_k: z.number().int().min(1).max(20).optional().describe("How many results to return (1-20, default 5)"),
      }),
      execute: async ({ query, top_k }) => {
        const cfg = useSettingsStore.getState().settings.semantic
        if (!cfg || !cfg.enabled) {
          return "Semantic index is disabled. Enable it in Settings > Semantic."
        }
        const idx = await loadIndex(workspace)
        if (!idx) {
          return "Semantic index is missing. Build it from Settings > Semantic > Build index."
        }
        const results = await queryIndex({
          index: idx,
          cfg: {
            provider: cfg.provider,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            apiKey: cfg.apiKey,
          },
          query,
          topK: top_k ?? cfg.topK ?? 5,
        })
        if (results.length === 0) return "(no matches)"
        return results
          .map((r, i) => {
            const head = `## ${i + 1}. ${r.chunk.path}:${r.chunk.line0}-${r.chunk.line1}  (sim=${r.score.toFixed(3)})`
            const snippet =
              r.chunk.text.length > 1500 ? sliceCharsSafe(r.chunk.text, 1500) + "\n... [truncated]" : r.chunk.text
            return `${head}\n\`\`\`\n${snippet}\n\`\`\``
          })
          .join("\n\n")
      },
    }),

    list_worktrees: tool({
      description:
        "List all git worktrees for the current repo (path, branch, head). Use it to see which branches are open in parallel sessions.",
      inputSchema: z.object({}),
      execute: async () => {
        await gateFor("list_worktrees", {})
        const entries = await listWorktreesImpl(workspace)
        if (entries.length === 0) return "(no worktrees)"
        return entries
          .map((e) => {
            const label = e.branch ? `branch=${e.branch}` : e.detached ? "(detached)" : ""
            const lock = e.locked ? ` 🔒${e.locked}` : ""
            return `- ${e.path}  ${label}  head=${e.head.slice(0, 7)}${lock}`
          })
          .join("\n")
      },
    }),

    remove_worktree: tool({
      description:
        "Remove the specified worktree (git worktree remove). force=true removes it despite uncommitted changes. " +
        "The active worktree currently attached to this session cannot be removed.",
      inputSchema: z.object({
        target: z.string().describe("Absolute path of the worktree to remove"),
        force: z.boolean().optional().describe("Force removal even with uncommitted changes"),
      }),
      execute: async ({ target, force }) => {
        await gateFor("remove_worktree", { target, force })
        await removeWorktreeImpl(workspace, target, force ?? false)
        return `Worktree removed: ${target}`
      },
    }),

    create_pr: tool({
      description: CREATE_PR_DESC,
      inputSchema: z.object({
        title: z.string().describe("PR title, short and imperative like a commit subject"),
        body: z
          .string()
          .optional()
          .describe("PR description (Markdown). If it resolves an issue, include 'Closes #N'."),
        base: z
          .string()
          .optional()
          .describe("Base branch to merge into. If omitted, the repo default branch is used."),
        draft: z.boolean().optional().describe("Open as a draft PR (default false)"),
      }),
      execute: async ({ title, body, base, draft }) => {
        await gateFor("create_pr", { title, base, draft })
        const repo = await resolveRepo(workspace)
        if (!repo) {
          throw new Error(
            "create_pr: workspace is not a GitHub repo (origin remote must be github.com).",
          )
        }
        const token = await getGithubToken()
        if (!token) {
          throw new Error(
            "create_pr: missing GitHub token. Add a token with `repo` scope in Settings > GitHub.",
          )
        }
        const st = await gitStatus(workspace)
        if (!st.isRepo) throw new Error("create_pr: no git repo here.")
        if (!st.info.clean) {
          throw new Error(
            "create_pr: working tree is not clean; commit changes first " +
              "(uncommitted work is not included in the PR).",
          )
        }
        const head = st.info.branch
        if (!head) {
          throw new Error("create_pr: detached HEAD; switch to a feature branch (git checkout -b ...).")
        }
        const baseBranch = base?.trim() || (await gitDefaultBranch(workspace)) || "main"
        if (head === baseBranch) {
          throw new Error(
            `create_pr: you are on the base branch '${baseBranch}'; create a feature branch first (git checkout -b ...).`,
          )
        }
        await gitPublish(workspace)
        try {
          const pr = await createPullRequest(token, repo, { title, head, base: baseBranch, body, draft })
          return [`PR opened #${pr.number}`, pr.htmlUrl, `${head} -> ${baseBranch}`].join("\n")
        } catch (e) {
          if (e instanceof GithubApiError) {
            throw new Error(`create_pr: GitHub rejected the request: ${errorMessage(e)}`, { cause: e })
          }
          throw e
        }
      },
    }),

    apply_patch: tool({
      description: APPLY_PATCH_DESC,
      inputSchema: z.object({
        patch: z
          .string()
          .describe("The full patch text — starts with *** Begin Patch and ends with *** End Patch"),
      }),
      execute: async ({ patch }) => {
        await gateFor("apply_patch", { patch })
        const result = await withLock(`apply_patch:${workspace ?? "."}`, () =>
          applyPatchImpl(workspace, patch),
        )
        let out = formatApplyResult(result)
        if (autoFormatEnabled(workspace)) {
          const paths = [
            ...result.filesChanged,
            ...result.filesAdded,
            ...result.filesMoved.map((m) => m.to),
          ]
          for (const p of paths) {
            const surfaced = await runFormatters(workspace, p)
            if (surfaced) out += `\n\n${surfaced}`
          }
        }
        return out
      },
    }),

    load_skill: tool({
      description: SKILL_DESC,
      inputSchema: z.object({
        name: z.string().describe("Name of the skill to load (from the catalog in the system prompt)"),
      }),
      execute: async ({ name }) => {
        const s = await loadSkillByName(configWorkspace, name)
        if (!s) return `Skill not found: ${name}`
        const parts = [`# ${s.name} (${s.scope})`, s.description, "", "---", "", s.body]
        try {
          const files = await listSkillFiles(s.dir)
          if (files.length) {
            parts.push("", `Base directory: ${s.dir}`)
            parts.push(
              "Relative paths in this skill (scripts/, reference/, etc.) are relative to the base directory above.",
            )
            parts.push("", "<skill_files>")
            parts.push(...files.map((f) => `  ${f}`))
            parts.push("</skill_files>")
          }
        } catch {
          // Intentionally ignored.
        }
        return parts.join("\n")
      },
    }),

    todo_write: tool({
      description: TODOWRITE_DESC,
      inputSchema: z.object({
        todos: z
          .array(
            z.object({
              content: z.string().describe("Brief, action-oriented task step"),
              status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
              priority: z
                .enum(["high", "medium", "low"])
                .optional()
                .describe("Optional priority hint for ordering"),
            }),
          )
          .describe("The full list — replaces the previous one entirely"),
      }),
      execute: async ({ todos }) => {
        useSessionsStore.getState().setTodosFor(ownerSessionId, todos)
        const done = todos.filter((t) => t.status === "completed").length
        const active = todos.find((t) => t.status === "in_progress")
        return (
          `Todo updated: ${todos.length} items, ${done} completed.` +
          (active ? ` Current: ${active.content}` : "")
        )
      },
    }),

    dispatch_workers: tool({
      description:
        "ORCHESTRA MODE: dispatch one or more tasks to the worker pool in PARALLEL. " +
        "When all workers finish, results return as a JSON list. Workers operate independently " +
        "and have no direct communication with each other; you must synthesize the result. The current worker pool " +
        "is listed in the system prompt catalog.",
      inputSchema: z.object({
        dispatches: z
          .array(
            z.object({
              workerIdx: z
                .number()
                .int()
                .min(1)
                .max(5)
                .describe("Worker index in the pool (1-5)"),
              task: z
                .string()
                .describe("Task for the worker: clear, self-contained, and concise"),
            }),
          )
          .min(1)
          .max(5),
      }),
      execute: async ({ dispatches }, ctx) => {
        const sess = useSessionsStore.getState().sessions[ownerSessionId]
        if (!sess?.orchestra || sess.mode !== "orchestra") {
          throw new Error("Orchestra mode is not active; dispatch_workers cannot be called")
        }
        const pendingMsg = [...sess.messages]
          .reverse()
          .find((m) => m.role === "assistant" && m.pending)
        if (!pendingMsg) throw new Error("Pending assistant message not found")

        // Propagate the parent streamText abort signal to workers (Composer "stop").
        const parentSignal = (ctx as { abortSignal?: AbortSignal } | undefined)?.abortSignal

        const { dispatchWorkers } = await import("../orchestra/runtime")
        const results = await dispatchWorkers(
          sess.orchestra,
          dispatches,
          pendingMsg.id,
          ownerSessionId,
          sess.workspacePath,
          parentSignal,
        )
        const trimmed = results.map((r) => ({
          ...r,
          output: truncateForContext(r.output, WORKER_OUTPUT_MAX),
          changedFiles:
            Array.isArray(r.changedFiles) && r.changedFiles.length > 50
              ? [...r.changedFiles.slice(0, 50), `... +${r.changedFiles.length - 50} more files`]
              : r.changedFiles,
          errorMessage: r.errorMessage
            ? truncateForContext(r.errorMessage, 2000)
            : r.errorMessage,
        }))
        return JSON.stringify(trimmed, null, 2)
      },
    }),

    delegate_agents: tool({
      description: DELEGATE_AGENTS_DESC,
      inputSchema: z.object({
        dispatches: z
          .array(
            z.object({
              poolEntryId: z.string().min(1).describe("Enabled pool entry id from the Agent Pool"),
              task: z.string().min(1).describe("Clear, self-contained subtask"),
            }),
          )
          .min(1)
          .max(5),
      }),
      execute: async ({ dispatches }, ctx) => {
        await gateFor("delegate_agents", { dispatches })
        const session = useSessionsStore.getState().sessions[ownerSessionId]
        if (!session) throw new Error("Session not found")
        const parentMessage = [...session.messages]
          .reverse()
          .find((message) => message.role === "assistant" && message.pending)
        if (!parentMessage) throw new Error("Pending assistant message not found")
        const { dispatchSupervisorAgents } = await import("@/lib/agents/runtime")
        const results = await dispatchSupervisorAgents({
          session,
          parentMessageId: parentMessage.id,
          settings: useSettingsStore.getState().settings.supervisor,
          dispatches,
          signal: (ctx as { abortSignal?: AbortSignal } | undefined)?.abortSignal,
        })
        return JSON.stringify(
          results.map((result) => ({
            ...result,
            output: truncateForContext(result.output, WORKER_OUTPUT_MAX),
          })),
          null,
          2,
        )
      },
    }),

    merge_workers: tool({
      description:
        "ORCHESTRA MODE: conflict-aware merge of isolated worker branches (codezal/wk-*) into the current branch. " +
        "Each writing worker commits to its own branch after dispatch_workers; this tool merges them sequentially. " +
        "If the parent working tree is DIRTY, it safely skips to avoid risking the user's uncommitted work. " +
        "Instead of forcing conflicts, it reports per branch; conflicted merges are aborted and the rest continue. " +
        "After successful merges, VERIFY with build/tests. Take branch names from the 'branch' field in dispatch_workers results.",
      inputSchema: z.object({
        branches: z
          .array(z.string())
          .min(1)
          .describe("Worker branch names to merge (for example 'codezal/wk-1-1-ab12cd34')"),
      }),
      execute: async ({ branches }) => {
        const sess = useSessionsStore.getState().sessions[ownerSessionId]
        if (!sess?.orchestra || sess.mode !== "orchestra") {
          throw new Error("Orchestra mode is not active; merge_workers cannot be called")
        }
        const wsPath = sess.workspacePath
        if (!wsPath) return "No workspace; cannot merge."
        const repoPath = await findRepoRoot(wsPath)
        if (!repoPath) return "Not a git repo; cannot merge."
        await gateFor("merge_workers", { branches })
        const { mergeWorkerBranches } = await import("../orchestra/isolation")
        const results = await mergeWorkerBranches(repoPath, branches)
        return results
          .map((r) => {
            if (r.status === "merged") return `✅ ${r.branch} → merged (${r.mergeSha})`
            if (r.status === "conflict")
              return `⚠️ ${r.branch} → CONFLICT: ${r.conflictFiles?.join(", ") ?? "?"} (aborted, not merged)`
            if (r.status === "skipped") return `⏭️ ${r.branch} → skipped: ${r.note ?? ""}`
            return `❌ ${r.branch} → error: ${r.note ?? ""}`
          })
          .join("\n")
      },
    }),

    spawn_agent: tool({
      description: SPAWN_AGENT_DESC,
      inputSchema: z.object({
        name: z.string().describe("Agent type to use (from the catalog in your system prompt)"),
        task: z.string().describe("Detailed, self-contained task for the agent to perform"),
      }),
      execute: async ({ name, task }, ctx) => {
        await gateFor("spawn_agent", { name, task })
        const agent = await findAgent(configWorkspace, name)
        if (!agent) return `Agent not found: ${name}`

        try {
          const startHooks = getEffectiveSettings(workspace).hooks ?? []
          await runHooks({
            hooks: [...startHooks, ...listPluginHooks()],
            event: "SubagentStart",
            payload: { agent: name, task },
            workspace,
          })
        } catch (e) {
          console.warn("[hook] SubagentStart error:", e)
        }

        const fireSubagentStop = async (reason: string) => {
          try {
            const stopHooks = getEffectiveSettings(workspace).hooks ?? []
            await runHooks({
              hooks: [...stopHooks, ...listPluginHooks()],
              event: "SubagentStop",
              payload: { reason },
              workspace,
            })
          } catch (e) {
            console.warn("[hook] SubagentStop error:", e)
          }
        }

        const supervisorSettings = useSettingsStore.getState().settings.supervisor
        const { findSupervisorPoolEntry, dispatchSupervisorAgents } = await import(
          "@/lib/agents/runtime"
        )
        const poolEntry = findSupervisorPoolEntry(supervisorSettings, name)
        if (poolEntry && poolEntry.engine.kind !== "sdk") {
          const parent = useSessionsStore.getState().sessions[ownerSessionId]
          const pendingMessage = parent
            ? [...parent.messages].reverse().find((message) => message.role === "assistant" && message.pending)
            : undefined
          if (!parent || !pendingMessage) return "Pending assistant message not found"
          const [result] = await dispatchSupervisorAgents({
            session: parent,
            parentMessageId: pendingMessage.id,
            settings: supervisorSettings,
            dispatches: [{ poolEntryId: poolEntry.id, task }],
            signal: (ctx as { abortSignal?: AbortSignal } | undefined)?.abortSignal,
          })
          void fireSubagentStop(result.status)
          if (result.status !== "done") return `Agent error: ${result.errorMessage ?? result.status}`
          return `# ${agent.name} summary\n${truncateForContext(result.output, SPAWN_OUTPUT_MAX)}`
        }

        // Provider/model fallback from the parent session.
        const parent = useSessionsStore.getState().sessions[ownerSessionId]
        const provider = (agent.provider ?? parent?.provider) as ProviderId | undefined
        const modelId = agent.model ?? parent?.model
        if (!provider || !modelId) return "Provider/model could not be determined"

        const settings = useSettingsStore.getState().settings
        let model
        try {
          model = await buildLanguageModel({ providerId: provider, modelId, settings })
        } catch (e) {
          return `Model could not be initialized: ${e instanceof Error ? e.message : String(e)}`
        }

        const fullSet = buildTools(workspace, ownerSessionId)
        const subTools: ToolSet = {}
        const SUBAGENT_STRIP = new Set(["spawn_agent", "delegate_agents", "dispatch_workers", "merge_workers"])
        if (agent.tools && agent.tools.length > 0) {
          for (const t of agent.tools) {
            if (!SUBAGENT_STRIP.has(t) && fullSet[t]) subTools[t] = fullSet[t]
          }
        } else {
          for (const k of Object.keys(fullSet)) {
            if (!SUBAGENT_STRIP.has(k)) subTools[k] = fullSet[k]
          }
        }

        // Apply policy: bash whitelist/deny, approval_required, plan_mode.
        const policedTools = wrapToolsWithPolicy(subTools, agent.policy, ownerSessionId)

        // Dynamic import createCardEmitter to avoid index -> orchestra/runtime -> runners -> tools cycles.
        const sess = useSessionsStore.getState().sessions[ownerSessionId]
        const pendingMsg = sess
          ? [...sess.messages].reverse().find((m) => m.role === "assistant" && m.pending)
          : undefined
        const cardId = createId("worker")
        let emit: (ev: WorkerEvent) => void = () => {}
        if (pendingMsg) {
          const card: AgentCardPart = {
            type: "agent-card",
            workerId: cardId,
            workerIdx: 0,
            taskNum: 1,
            task,
            workerLabel: `agent: ${agent.name}`,
            displayName: agent.name,
            kind: "sdk",
            configSnapshot: {
              kind: "sdk",
              provider,
              model: modelId,
              yolo: false,
              presetAgent: agent.name,
            },
            status: "pending",
            outputLog: [],
            toolCalls: [],
            startedAt: Date.now(),
          }
          useSessionsStore.getState().pushAgentCardFor(ownerSessionId, pendingMsg.id, card)
          const { createCardEmitter } = await import("../orchestra/runtime")
          emit = createCardEmitter(ownerSessionId, pendingMsg.id, cardId, 200)
        }

        const parentSignal = (ctx as { abortSignal?: AbortSignal } | undefined)?.abortSignal
        emit({ type: "started" })

        let finalText = ""
        let lastResult: ReturnType<typeof streamText> | undefined
        let lastErr: unknown
        let softStopped = false

        let currentAc: AbortController | undefined
        const spawnStart = Date.now()
        let attemptBeat = spawnStart
        const wd = setInterval(() => {
          const ac = currentAc
          if (!ac) return
          const now = Date.now()
          if (now - attemptBeat > AGENT_STALL_MS || now - spawnStart > AGENT_DEADLINE_MS) {
            softStopped = true
            ac.abort()
          }
        }, AGENT_WD_CHECK_MS)

        beginToolActivity(ownerSessionId)
        try {
          for (let attempt = 0; ; attempt++) {
            const childAc = new AbortController()
            currentAc = childAc
            const onParentAbort = () => childAc.abort()
            if (parentSignal) {
              if (parentSignal.aborted) childAc.abort()
              else parentSignal.addEventListener("abort", onParentAbort, { once: true })
            }
            attemptBeat = Date.now()
            try {
              const result = streamText({
                model,
                system: agent.systemPrompt,
                messages: [{ role: "user", content: task }],
                tools: policedTools,
                stopWhen: stepCountIs(agent.maxSteps ?? 40),
                abortSignal: childAc.signal,
                experimental_repairToolCall: makeToolCallRepair(),
              })
              lastResult = result
              for await (const chunk of result.fullStream) {
                attemptBeat = Date.now()
                beatTool(ownerSessionId)
                switch (chunk.type) {
                  case "text-delta": {
                    const d = chunk.text ?? ""
                    if (d) {
                      finalText += d
                      emit({ type: "text-delta", delta: d })
                    }
                    break
                  }
                  case "tool-call":
                    emit({ type: "tool-call", name: chunk.toolName, id: chunk.toolCallId })
                    break
                  case "tool-result":
                    emit({ type: "tool-result", name: chunk.toolName, id: chunk.toolCallId })
                    break
                  case "tool-error":
                    emit({ type: "tool-result", name: chunk.toolName, id: chunk.toolCallId, isError: true })
                    break
                  case "error": {
                    const err = chunk.error
                    throw err instanceof Error ? err : new Error(String(err))
                  }
                }
              }
              try {
                const usage = await result.usage
                if (usage) {
                  emit({
                    type: "usage",
                    tokensIn: usage.inputTokens ?? undefined,
                    tokensOut: usage.outputTokens ?? undefined,
                  })
                }
              } catch {
                // Intentionally ignored.
              }
              break // stream completed cleanly
            } catch (e) {
              lastErr = e
              if (softStopped) break
              if (parentSignal?.aborted) break
              const parsed = parseStreamError(e)
              if (!finalText.trim() && isRetryableError(parsed) && attempt < MAX_SUBAGENT_RETRIES) {
                await new Promise((r) =>
                  setTimeout(
                    r,
                    retryDelayMs(attempt + 1, parsed?.type === "api_error" ? parsed.retryAfterMs : undefined),
                  ),
                )
                continue
              }
              break
            } finally {
              if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort)
            }
          }
        } finally {
          clearInterval(wd)
          endToolActivity(ownerSessionId)
        }

        let text = finalText.trim()

        if (!text && lastErr !== undefined && !softStopped && !parentSignal?.aborted) {
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
          emit({ type: "error", message: msg })
          void fireSubagentStop("error")
          return `Agent error: ${msg}`
        }

        if (!text && lastResult && !softStopped && !parentSignal?.aborted) {
          const sumAc = new AbortController()
          const sumTimer = setTimeout(() => sumAc.abort(), AGENT_SUMMARY_TIMEOUT_MS)
          try {
            const resp = await lastResult.response
            const wrap = await generateText({
              model,
              messages: [
                ...resp.messages,
                { role: "user", content: "Summarize your findings so far as the final answer." },
              ],
              abortSignal: sumAc.signal,
            })
            text = wrap.text.trim()
          } catch {
            // Ignore; fall through to the empty fallback message below.
          } finally {
            clearTimeout(sumTimer)
          }
        }
        if (!text) text = "(agent returned an empty response)"
        if (softStopped || parentSignal?.aborted) {
          text += "\n\n_(note: agent hit the time/silence limit or was stopped; partial result)_"
        }
        emit({ type: "complete", text })
        void fireSubagentStop(parentSignal?.aborted ? "aborted" : "complete")
        return `# ${agent.name} summary\n${truncateForContext(text, SPAWN_OUTPUT_MAX)}`
      },
    }),

    run_workflow: tool({
      description: RUN_WORKFLOW_DESC,
      inputSchema: z.object({
        script: z
          .string()
          .min(20)
          .max(100_000)
          .describe("Full workflow JS script starting with export const meta = {...}"),
        args: z.unknown().optional().describe("Value passed to the script as the global `args`"),
        resumeFromRunId: z
          .string()
          .optional()
          .describe("Resume from a previous run; unchanged agent() prefixes return from cache"),
      }),
      execute: async ({ script, args, resumeFromRunId }) => {
        await gateFor("run_workflow", { script })
        const runId = await useWorkflowsStore.getState().spawn({
          sessionId: ownerSessionId,
          script,
          args,
          workspace,
          configWorkspace,
          resumeFromRunId,
        })
        return `Workflow started (runId: ${runId}). Read progress and final result with workflow_status({ runId: "${runId}", wait: true }).`
      },
    }),

    workflow_status: tool({
      description: WORKFLOW_STATUS_DESC,
      inputSchema: z.object({
        runId: z.string().optional().describe("Run id; omit to list all runs"),
        wait: z.boolean().optional().describe("true -> block until the run finishes, bounded"),
      }),
      execute: async ({ runId, wait }) => {
        const store = useWorkflowsStore.getState()
        if (!runId) return formatWorkflowList(store.list())
        let run = store.read(runId)
        if (!run) return `Workflow not found: ${runId}`
        if (wait && run.status === "running") {
          run = (await store.wait(runId, WF_DEFAULT_WAIT_MS)) ?? run
        }
        return formatWorkflowRun(run)
      },
    }),

    propose_build: tool({
      description: PROPOSE_BUILD_DESC,
      inputSchema: z.object({
        plan: z
          .string()
          .min(40)
          .describe(
            "The full implementation plan in markdown — which files change, what changes in each, and in what order. The user reviews this entire plan before approving.",
          ),
      }),
      execute: async ({ plan }) => {
        const currentMode = useSessionsStore.getState().sessions[ownerSessionId]?.mode ?? "build"
        if (currentMode !== "plan") {
          return "propose_build can only be used in plan mode. You are already in build mode."
        }
        const answer = await useQuestionsStore.getState().ask(ownerSessionId, [
          {
            question: "Plan is ready. Switch to build mode?",
            body: plan,
            options: [
              { label: "Approve", description: "Switch to build mode and apply the plan" },
              { label: "Reject", description: "Stay in plan mode and improve it" },
            ],
            custom: true,
          },
        ])
        const picked = answer[0] ?? []
        const label = (picked[0] ?? "").trim()
        if (label === "Approve") {
          useSessionsStore.getState().setModeFor(ownerSessionId, "build")
          return (
            "Switched to build mode; write_file, edit_file, bash, and apply_patch are now active. " +
            "Apply the plan."
          )
        }
        if (label && label !== "Reject" && label !== NO_ANSWER) {
          return `The user wants this plan revision:\n\n${label}\n\nUpdate the plan with this feedback and propose it again.`
        }
        return "Continuing in plan mode. Improve the plan further or propose it again."
      },
    }),

    propose_plan: tool({
      description: PROPOSE_PLAN_DESC,
      inputSchema: z.object({
        reason: z
          .string()
          .min(20)
          .describe("Why you want to switch to plan mode — which uncertainty or risk to resolve"),
      }),
      execute: async ({ reason }) => {
        const currentMode = useSessionsStore.getState().sessions[ownerSessionId]?.mode ?? "build"
        if (currentMode !== "build") {
          return "propose_plan can only be used in build mode. You are already in plan mode."
        }
        const answer = await useQuestionsStore.getState().ask(ownerSessionId, [
          {
            question: "The model wants more analysis. Switch to plan mode?",
            body: `**Reason:**\n${reason}`,
            options: [{ label: "Yes, switch to plan mode" }, { label: "No, continue build mode" }],
          },
        ])
        if ((answer[0]?.[0] ?? "").startsWith("Yes")) {
          useSessionsStore.getState().setModeFor(ownerSessionId, "plan")
          return (
            "Switched to plan mode; write_file, edit_file, bash, and apply_patch are disabled. " +
            "read_file, grep, list_dir, and webfetch remain active. Call propose_build when analysis is complete."
          )
        }
        return "Continuing in build mode."
      },
    }),

    notebook_edit: tool({
      description: NOTEBOOK_EDIT_DESC,
      inputSchema: z.object({
        path: z.string().describe("Notebook (.ipynb) path relative to the workspace root"),
        cell_number: z.number().int().optional().describe("0-based cell index"),
        cell_id: z
          .string()
          .optional()
          .describe("nbformat cell id (takes precedence over cell_number)"),
        cell_type: z
          .enum(["code", "markdown"])
          .optional()
          .describe("Required for insert; on replace changes the cell type"),
        edit_mode: z
          .enum(["replace", "insert", "delete"])
          .optional()
          .describe("replace (default) | insert | delete"),
        new_source: z.string().optional().describe("Full new contents of the cell"),
      }),
      execute: async ({ path, cell_number, cell_id, cell_type, edit_mode, new_source }) => {
        await gateFor("notebook_edit", { path })
        const abs = await resolvePathOrAsk(workspace, path, "notebook_edit")
        return editNotebook(abs, {
          editMode: edit_mode ?? "replace",
          cellNumber: cell_number,
          cellId: cell_id,
          cellType: cell_type,
          newSource: new_source,
        })
      },
    }),

    schedule_task: tool({
      description: SCHEDULE_TASK_DESC,
      inputSchema: z.object({
        action: z.enum(["create", "list", "delete"]),
        name: z.string().optional(),
        prompt: z.string().optional(),
        schedule: z.string().optional().describe("5-field cron, local time (recurring)"),
        delay: z
          .string()
          .optional()
          .describe("One-shot delay e.g. '5m','30s','2h','1d' — fires once after this delay, then auto-deletes. Mutually exclusive with schedule."),
        description: z.string().optional(),
        scope: z.enum(["project", "global"]).optional(),
        path: z.string().optional().describe("Routine file path — for delete"),
      }),
      execute: async ({ action, name, prompt, schedule, delay, description, scope, path }) => {
        if (action === "list") {
          const [proj, user] = await Promise.all([
            readWorkspaceRoutines(configWorkspace),
            readUserRoutines(),
          ])
          const all = [...proj, ...user]
          if (!all.length) return "No saved routines."
          return all
            .map((r) => {
              let next = ""
              if (r.schedule) {
                try {
                  const d = nextFireAt(parseCron(r.schedule))
                  if (d) next = ` -> next: ${d.toLocaleString()}`
                } catch {
                  // Intentionally ignored.
                }
              }
              return `- [${r.scope}] ${r.name}${r.once ? " [one-shot]" : ""}${r.schedule ? ` (cron: ${r.schedule})` : ""}${next}\n  ${r.path}`
            })
            .join("\n")
        }
        const mode = useSessionsStore.getState().sessions[ownerSessionId]?.mode ?? "build"
        if (mode === "plan") {
          return "Cannot create/delete routines in plan mode; switch to build mode."
        }
        if (action === "delete") {
          if (!path) return "path is required for delete; find it with list first."
          await gateFor("schedule_task", { action, path })
          await deleteRoutine(path)
          await refreshScheduler(configWorkspace)
          return `Routine deleted: ${path}`
        }
        // create
        if (!name || !prompt) return "name and prompt are required for create."
        if (delay && schedule) {
          return "delay and schedule cannot be used together; choose one-shot delay or recurring schedule."
        }
        let effSchedule = schedule
        let once = false
        let fireAt: Date | undefined
        if (delay) {
          const mins = parseDelayMinutes(delay)
          if (mins == null) return `Invalid delay: '${delay}' (for example '5m','30s','2h','1d').`
          const r = delayToCron(mins)
          effSchedule = r.cron
          fireAt = r.fireAt
          once = true
        } else if (schedule) {
          const err = validateCron(schedule)
          if (err) return `Invalid cron: ${err}`
        }
        await gateFor("schedule_task", { action, name, schedule: effSchedule })
        const p = await writeRoutine(
          scope ?? "project",
          { name, description, prompt, schedule: effSchedule, once, fireAt: once && fireAt ? fireAt.toISOString() : undefined },
          configWorkspace,
        )
        await refreshScheduler(configWorkspace)
        if (once && fireAt) {
          return `One-shot routine saved: ${p} -> ${fireAt.toLocaleString()} (auto-deletes after firing)`
        }
        return `Routine saved: ${p}${effSchedule ? ` (cron: ${effSchedule})` : " (manual; no schedule)"}`
      },
    }),

    monitor: tool({
      description: MONITOR_DESC,
      inputSchema: z.object({
        action: z.enum(["start", "stop", "list"]).optional(),
        command: z.string().optional().describe("Command to watch (for start)"),
        pattern: z
          .string()
          .optional()
          .describe("Regex; matching lines emit events. Omit to match every line."),
        description: z.string().optional().describe("Short UI title in the user's language"),
        on_event: z
          .enum(["respond", "chat", "notify"])
          .optional()
          .describe("Override the default monitor behavior for this watch"),
        id: z.string().optional().describe("Monitor id — for stop"),
      }),
      execute: async ({ action, command, pattern, on_event, id }) => {
        const act = action ?? "start"
        if (act === "list") {
          const ms = listMonitors()
          return ms.length ? ms.map((m) => `${m.id}: ${m.command}`).join("\n") : "No active monitors."
        }
        if (act === "stop") {
          if (!id) return "id is required for stop."
          const ok = await stopMonitor(id)
          return ok ? `Monitor stopped: ${id}` : `Monitor not found: ${id}`
        }
        // start
        if (!command) return "command is required for start."
        await gateFor("monitor", { command })
        const behavior = on_event ?? useSettingsStore.getState().settings.monitorAction ?? "respond"
        const sid = ownerSessionId
        const monId = await startMonitor({
          workspace,
          command,
          pattern,
          onEvent: (line) => {
            if (behavior === "respond") {
              // Automatic turn: the App.tsx monitor-bus listener calls onSend for the session.
              emitMonitor({ sessionId: sid, line, monitorId: monId })
            } else {
              const msg: Message = {
                id: createId("message"),
                role: "assistant",
                content: `🔔 [monitor] ${line}`,
              }
              useSessionsStore.getState().pushMessageFor(sid, msg)
              if (behavior === "notify") void sendDesktopNotification("Monitor", line)
            }
          },
        })
        return `Monitor started (id: ${monId}, behavior: ${behavior}). Stop it with monitor({ action: "stop", id: "${monId}" }).`
      },
    }),
  }
}

// Code Map tools — Code Map v2: sorgular Rust SQLite backend'ine (codemap_*
function buildCodeMapTools(workspace: string | undefined): ToolSet {
  const enabled = useSettingsStore.getState().settings.tokenSavers?.codeMap.enabled
  if (!enabled || !workspace) return {}
  const ws = workspace

  const builtHint =
    "Code Map not built yet. Settings → Token Saving → Code Map → Build index (or run /codemap-index)."
  const symList = (syms: CodeSymbol[]): string =>
    syms.length === 0 ? "(no matches)" : syms.map((s) => `- ${formatSymbol(s)}`).join("\n")
  const toName = (ref: string): string => (ref.includes("::") ? (ref.split("::")[1] ?? ref) : ref)
  const orHint = async (syms: CodeSymbol[]): Promise<string> => {
    if (syms.length > 0) return symList(syms)
    try {
      const st = await invoke<{ symbols: number }>("codemap_status", { workspace: ws })
      return st.symbols > 0 ? "(no matches)" : builtHint
    } catch {
      return "(no matches)"
    }
  }

  return {
    code_search: tool({
      description:
        "Search the Code Map for symbols by name. Returns matching functions, classes, methods, types " +
        "with file:line and a short signature. Prefer this over grep to find where a symbol is defined — " +
        "it is exact, ranked, and the index stays fresh automatically. Use it before code_callers / " +
        "code_callees to resolve the exact symbol id when a name has multiple definitions.",
      inputSchema: z.object({
        query: z.string().describe("Symbol name or partial name (case-insensitive)"),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, limit }) =>
        orHint(
          await invoke<CodeSymbol[]>("codemap_search", { workspace: ws, query, limit: limit ?? 20 }),
        ),
    }),

    code_callers: tool({
      description:
        "List functions/methods that call the given symbol — every caller across the codebase in ONE call, " +
        "including dynamic-dispatch edges grep can't follow. Prefer this over grepping for a symbol's usages. " +
        "Pass the symbol name or its full id from code_search.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id ('file::name::line')"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const syms = await invoke<CodeSymbol[]>("codemap_callers", { workspace: ws, name: toName(symbol) })
        // Default cap 100 — limit verilmezse "log/format" gibi hot sembollerin binlerce
        return orHint(syms.slice(0, limit ?? 100))
      },
    }),

    code_callees: tool({
      description:
        "List the functions/methods that the given symbol calls. Pass the symbol name or its full id from code_search.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id ('file::name::line')"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const syms = await invoke<CodeSymbol[]>("codemap_callees", { workspace: ws, name: toName(symbol) })
        return orHint(syms.slice(0, limit ?? 100))
      },
    }),

    code_trace: tool({
      description:
        "Find a call-path from one symbol to another (BFS over the calls graph). Returns the chain in order, " +
        "or '(no path)' when unreachable. Use for 'how does X reach Y' questions.",
      inputSchema: z.object({
        from: z.string().describe("Source symbol name or id"),
        to: z.string().describe("Target symbol name or id"),
      }),
      execute: async ({ from, to }) => {
        const path = await invoke<string[]>("codemap_trace", {
          workspace: ws,
          from: toName(from),
          to: toName(to),
        })
        return path.length === 0 ? "(no path)" : path.map((n, i) => `${i + 1}. ${n}`).join("  →  ")
      },
    }),

    code_impact: tool({
      description:
        "Transitive callers of a symbol — the 'blast radius' of changing it. Follows the call graph across the " +
        "whole codebase (grep cannot), so reach for this before a rename or signature change instead of grepping.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const syms = await invoke<CodeSymbol[]>("codemap_impact", {
          workspace: ws,
          name: toName(symbol),
          limit: limit ?? 60,
        })
        return orHint(syms)
      },
    }),

    code_context: tool({
      description:
        "Assemble a focused, goal-specific context bundle for a symbol in ONE call: its definition(s) plus " +
        "the functions that call it (callers) and the functions it calls (callees). Prefer this over separate " +
        "code_search + code_callers + code_callees when you need to understand a symbol before editing it.",
      inputSchema: z.object({
        symbol: z.string().describe("Symbol name or id ('file::name::line')"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ symbol, limit }) => {
        const b = await invoke<{
          seeds: CodeSymbol[]
          callers: CodeSymbol[]
          callees: CodeSymbol[]
        }>("codemap_context", { workspace: ws, name: toName(symbol), limit: limit ?? 25 })
        if (b.seeds.length === 0 && b.callers.length === 0 && b.callees.length === 0)
          return orHint([])
        const section = (title: string, syms: CodeSymbol[]): string =>
          `### ${title}\n${syms.length ? syms.map((s) => `- ${formatSymbol(s)}`).join("\n") : "(none)"}`
        return [
          section(b.seeds.length > 1 ? "Definitions" : "Definition", b.seeds),
          section("Callers (who uses it)", b.callers),
          section("Callees (what it uses)", b.callees),
        ].join("\n\n")
      },
    }),
  }
}
