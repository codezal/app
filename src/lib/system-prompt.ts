// System prompt assembler — base persona + memory files + workspace meta.
import {
  readProjectMemory,
  readUserMemory,
  readConfiguredInstructions,
  buildMemorySystemPrompt,
} from "./memory"
import { DEFAULT_MEMORY, type MemorySettings } from "./memory-settings"
import { loadMemoryContextBlock } from "./memory-store"
import { loadMethodsCatalog } from "./methods"
import { buildSkillsPromptSection } from "./skills"
import { readWorkspaceAgents, readUserAgents, buildAgentsCatalog } from "./agents"
import { listPluginAgents } from "./agents/plugin"
import { briefModeSection } from "./token-savers"
import type { TokenSaverSettings } from "./token-savers/types"
import { useI18nStore, languageName } from "./i18n"
import { useSettingsStore } from "@/store/settings"
import { sddAssistantPreamble } from "./sdd-prompts"
import type { SddStage } from "@/store/types"
import type { ProviderId } from "./providers"
import type { SupervisorSettings } from "@/lib/agents/runtime"
import { DEFAULT_SUPERVISOR_SETTINGS } from "@/lib/agents/runtime/supervisor"
import { rolesCatalogForPrompt } from "@/lib/agents/runtime/roles"
import { COMMIT_ATTRIBUTION_TRAILER } from "./commit-attribution"
import { BASE_SYSTEM } from "./prompts/base-system"

// Progress-narration policy — appended only when the user keeps narration on
// (settings.narrateProgress). Scoped to meaningful events so the flow feels
// fluid without becoming chatty.
const NARRATION_POLICY = `## Progress narration
Narrate progress so the session feels fluid — but only on MEANINGFUL events: a plan, a discovery, a tradeoff, a blocker, or the start of a non-trivial edit/verification. Before a substantial step, write ONE short sentence on what you are about to do ("Now checking the auth layer"). After the results, give the finding + next step in one line ("Auth looks clean; moving to the order API"). Do NOT narrate routine reads, searches, or obvious next steps, and combine related progress into a single line. Never work silently and dump one report only at the very end.`

// Code-navigation routing — the workspace ships an always-fresh tree-sitter Code
// Map (auto-built on open, incrementally reindexed on edit). Models default to
// grep (training prior); this section steers STRUCTURAL queries to the Code Map,
// which answers in one precise call and far fewer tokens. Injected only when a
// workspace is attached (no repo → no map).
const CODE_NAVIGATION = `## Code navigation — Code Map first, grep last

This workspace has an always-indexed, auto-updated Code Map (a tree-sitter symbol graph). It is AST-based: it follows dynamic dispatch, re-exports, and aliases that grep misses, and it costs far fewer tokens.

RULE — for any STRUCTURAL question you MUST use the Code Map tool, not grep:
- "Where is X defined" → code_search
- "What calls X / where is X used" → code_callers
- "What does X call" → code_callees
- "How does X reach Y" → code_trace
- "What breaks if I change X" → code_impact
- "Understand X before editing" → code_context (definition + callers + callees in ONE call)

grep is ONLY for literal text the Code Map does not model: string contents, log messages, i18n keys, config values, comments. NEVER grep for a symbol's definition, callers, or usages — that is slower, noisier, and misses edges the Code Map bridges.

Before editing any symbol, call code_context or code_impact FIRST. One code_context call ≈ 3–4 grep + read_file round-trips.

Trust Code Map results (full AST parse) — do not re-verify with grep. The index stays fresh automatically; never rebuild it manually.

This applies to ALL phases: analysis, implementation, debugging, review — not just the first exploration pass.`


type ModelFamily = "claude" | "gpt" | "gemini" | "kimi" | "generic"

// Normalize a "provider/model" label to a model family so we can layer
// family-specific guidance (different models follow narration cues differently).
function modelFamily(modelLabel?: string): ModelFamily {
  const s = (modelLabel ?? "").toLowerCase()
  if (/anthropic|claude/.test(s)) return "claude"
  if (/gemini|google/.test(s)) return "gemini"
  if (/kimi|moonshot/.test(s)) return "kimi"
  if (/openai|gpt|codex/.test(s)) return "gpt"
  return "generic"
}

// Per-family narration-style overlay, appended after the base policy (only when
// narration is enabled). Each family follows progress cues differently, so the
// delta tunes HOW it narrates — it does not repeat the base "what to skip" rules.
const FAMILY_OVERLAY: Record<ModelFamily, string> = {
  // Kimi is silent by default (its public coding prompt even disables
  // narration), so opt into preambles firmly rather than just refining tone.
  kimi:
    "## Progress narration (required)\n" +
    "Before EVERY group of tool calls, first write one short sentence saying what you are about to do. " +
    "After the results, write one short line with the finding and your next step. " +
    "Do not run tools silently — the user must see progress as it happens. Keep each note to one sentence.",
  // Claude narrates naturally but tends to be thorough — bias toward brevity.
  claude:
    "## Narration style\n" +
    "You tend to be thorough — keep each progress note to ONE short line, and don't restate what a tool already returned; give just the takeaway.",
  // GPT does well with commentary-style updates — frame each update as what + why.
  gpt:
    "## Narration style\n" +
    "Frame each progress note as what you are doing AND why, in a single line — not just a status label.",
  // Gemini leans anti-chitchat — keep it action-first with no filler openers.
  gemini:
    "## Narration style\n" +
    'Action-first: a few words per preamble, no filler openers ("Okay", "Sure", "Great").',
  generic: "",
}

export type SystemPromptInput = {
  workspacePath?: string
  modelLabel?: string
  mode?: "plan" | "build"
  sddStage?: SddStage
  sddRequirementPath?: string
  // Current session provider/model — used by the agent-roles catalog to show
  // which roles inherit the session model.
  session?: { provider: ProviderId; model: string }
  // Token-saver toggles — when Brief Mode is enabled, an extra directive is
  // injected so the model responds in compressed style.
  tokenSavers?: TokenSaverSettings
  // Active persistent goal — kept in the type for backward compatibility with
  // callers, but the goal directive is now emitted per-turn via
  // buildDynamicContext() (its iteration counter changes every turn, so it must
  // not live in the cache-stable system prompt). Ignored here.
  activeGoal?: { text: string; iter: number; maxIter: number; paused?: boolean }
  // Effective memory settings (global + sanitized project override). Drives the
  // memory read engine: extra instruction sources + byte budget. Absent →
  // DEFAULT_MEMORY.
  memory?: MemorySettings
  deferredTools?: string[]
  // MCP server-provided usage guidance (initialize result.instructions), per
  // server. Surfaced verbatim so the model follows each server's instructions.
  mcpInstructions?: { server: string; text: string }[]
  peers?: Array<{ id: string; title: string; handle: string }>
  ownHandle?: string
  // Kept for backward compatibility; the system prompt no longer reads the
  // latest user message (that would change the prefix every turn and break
  // prompt caching). Recall/auto-context now run in buildDynamicContext().
  recentText?: string
  delegationMode?: "inherit" | "solo" | "adaptive"
}

type MemoryPromptMode = "full" | "lean"

// STATIC memory sections — content that does NOT depend on the latest user
// message or the wall clock, so it is safe to keep in the cache-stable system
// prompt (the priority preamble + the user-authored rule files). The dynamic,
// query-dependent recall lives in buildDynamicContext() below.
export async function buildMemoryPromptSections(args: {
  workspacePath?: string
  memory?: MemorySettings
  recentText?: string
  mode?: MemoryPromptMode
}): Promise<string[]> {
  const sections: string[] = []
  const mem = args.memory ?? DEFAULT_MEMORY
  const lean = args.mode === "lean"
  const fileBudget = lean ? Math.min(mem.maxFileBytes, 8_000) : mem.maxFileBytes
  const totalBudget = lean ? Math.min(mem.totalBudgetBytes, 16_000) : mem.totalBudgetBytes

  sections.push(
    "\n## Memory Priority\n" +
      "Codezal may provide two memory sources below: user-authored rule files and learned memory from the database. Treat them as durable guidance, not as proof. Current user instructions override memory. Current repository files override stale memory. Before editing code, verify relevant facts with tools when possible.",
  )

  try {
    const readOpts = { maxFileBytes: fileBudget, cache: true }
    const [projectFiles, userFiles, configFiles] = await Promise.all([
      args.workspacePath ? readProjectMemory(args.workspacePath, readOpts) : Promise.resolve([]),
      readUserMemory(readOpts),
      readConfiguredInstructions(args.workspacePath, mem.instructions, readOpts),
    ])
    const memoryBlock = buildMemorySystemPrompt([...projectFiles, ...userFiles, ...configFiles], {
      totalBudgetBytes: totalBudget,
    })
    if (memoryBlock) sections.push("\n" + memoryBlock)
  } catch {
    // Memory files are advisory; read failures must never break prompt assembly.
  }

  return sections.length === 1 ? [] : sections
}

// Per-turn DYNAMIC context — everything that depends on the latest user message
// (learned-memory recall, method recall) or on the live
// goal iteration counter. This is deliberately kept OUT of the system prompt so
// the prompt prefix stays byte-for-byte identical across turns and the prompt
// cache keeps hitting. The harness (run-stream) appends the returned string to
// the latest user message as a <system-reminder> instead. Returns "" when there
// is nothing dynamic to add.
export async function buildDynamicContext(args: {
  workspacePath?: string
  memory?: MemorySettings
  recentText?: string
  activeGoal?: { text: string; iter: number; maxIter: number; paused?: boolean }
}): Promise<string> {
  const sections: string[] = []
  const mem = args.memory ?? DEFAULT_MEMORY
  const recentText = args.recentText

  if (mem.memoryStoreEnabled !== false) {
    try {
      const block = await loadMemoryContextBlock({
        workspace: args.workspacePath,
        now: Date.now(),
        query: recentText,
        budgetTokens: mem.memoryStoreBudgetTokens,
      })
      if (block) sections.push(block)
    } catch {
      // Learned-memory recall is best-effort.
    }

    try {
      const methodsBlock = await loadMethodsCatalog({
        workspace: args.workspacePath,
        query: recentText,
        now: Date.now(),
      })
      if (methodsBlock) sections.push(methodsBlock)
    } catch {
      // Method recall is best-effort.
    }
  }

  // Goal directive carries the live iteration counter (changes every turn) so it
  // belongs here, not in the cache-stable system prompt.
  if (args.activeGoal) sections.push(buildGoalBlock(args.activeGoal))

  return sections.join("\n\n")
}

// Persistent goal directive. Model continues autonomously across turns and
// MUST end its final assistant message with the exact sentinel `[GOAL_DONE]`
// when fully complete — the harness greps the assistant's final text for this
// token to decide whether to send an automatic "Continue." reply.
function buildGoalBlock(g: { text: string; iter: number; maxIter: number; paused?: boolean }): string {
  if (g.paused) {
    return [
      "## ACTIVE GOAL (PAUSED)",
      `User-defined persistent goal: ${g.text}`,
      `Iteration: ${g.iter}/${g.maxIter}`,
      "",
      "This goal is currently PAUSED by the user. Do NOT pursue it autonomously and do NOT emit `[GOAL_DONE]` or `[GOAL_BLOCKED]` — the harness will NOT auto-continue while paused. Address the user's current message normally; the goal stays on hold until the user resumes it.",
    ].join("\n")
  }
  return [
    "## ACTIVE GOAL",
    `User-defined persistent goal: ${g.text}`,
    `Iteration: ${g.iter + 1}/${g.maxIter}`,
    "",
    "Work autonomously toward this goal across multiple turns. After every assistant turn the harness will automatically send `Continue.` until you signal completion.",
    "",
    "Completion protocol:",
    "- When the goal is FULLY complete (all subtasks done, verification passed), end your final assistant message with the exact token `[GOAL_DONE]` on its own line. The harness greps for this token — anything else will trigger another iteration.",
    "- If the goal is impossible, blocked, or requires user input you cannot resolve, end your message with `[GOAL_BLOCKED]` and explain what is needed.",
    "- Do NOT emit either sentinel while work remains. Do NOT emit them speculatively.",
    "- If you hit the iteration cap, the harness will stop the loop and surface a system message to the user — no action needed from you.",
  ].join("\n")
}

function buildAgentRolesCatalog(supervisor: SupervisorSettings, session: SystemPromptInput["session"]): string {
  if (!supervisor.enabled) return ""
  return rolesCatalogForPrompt(supervisor, session ?? { provider: "openai", model: "" })
}

function buildPeerCatalog(
  peers: Array<{ title: string; handle: string }>,
  ownHandle?: string,
): string {
  const lines = [
    "## PEER SESSIONS",
    ownHandle
      ? `This session's handle is **@${ownHandle}** — other agents reach it with send_to_session({ to: "${ownHandle}", ... }).`
      : 'This session has no handle yet. Call set_session_handle({ handle: "..." }) so peers can address it.',
    "",
    "You can message these peer sessions directly — each wakes in the background and acts on your message:",
    "",
  ]
  for (const p of peers) lines.push(`- **@${p.handle}** — ${p.title}`)
  lines.push("")
  lines.push(
    'Use send_to_session({ to: "<handle>", message: "<self-contained instruction>" }) for autonomous coordination — e.g. ask a reviewer/CTO session to check a PR. The target cannot see this conversation, so include all context (paths, PR/issue numbers, what "done" means). If the target is busy the message is queued and delivered when its current turn ends; it can reply by sending back to your handle.',
  )
  return lines.join("\n")
}


// MCP server-provided usage instructions (each server's initialize
// result.instructions). Servers use this to tell the model how to use their
// tools; we surface it verbatim, attributed per server, so the guidance isn't
// lost. Empty list → no block. Each server is clamped so a single verbose (or
// hostile) server can't blow up the prompt budget.
const MAX_MCP_INSTRUCTIONS = 4_000
const MAX_MCP_INSTRUCTIONS_TOTAL = 12_000
function buildMcpInstructionsBlock(list: { server: string; text: string }[]): string {
  if (!list.length) return ""
  const lines = ["## MCP SERVER INSTRUCTIONS", "Usage guidance from connected MCP servers:"]
  let used = 0
  let omitted = 0
  for (let i = 0; i < list.length; i++) {
    const { server, text } = list[i]
    const clamped =
      text.length > MAX_MCP_INSTRUCTIONS ? `${text.slice(0, MAX_MCP_INSTRUCTIONS)}\n…(truncated)` : text
    if (used > 0 && used + clamped.length > MAX_MCP_INSTRUCTIONS_TOTAL) {
      omitted = list.length - i
      break
    }
    lines.push("", `### ${server}`, clamped)
    used += clamped.length
  }
  if (omitted > 0) {
    lines.push("", `…(${omitted} more server${omitted > 1 ? "s" : ""}' instructions omitted to fit the prompt budget)`)
  }
  return lines.join("\n")
}

// Build the prompt as a single string — for streamText({ system }).
export async function buildSystemPrompt({
  workspacePath,
  modelLabel,
  mode = "build",
  sddStage,
  sddRequirementPath,
  session,
  tokenSavers,
  memory,
  deferredTools,
  mcpInstructions,
  peers,
  ownHandle,
  delegationMode,
}: SystemPromptInput): Promise<string> {
  const parts: string[] = [BASE_SYSTEM]

  // Response-language directive — follows the user's selected locale so the
  // model replies in their language (the base prompt itself is English).
  // Strong, explicit wording: models (esp. non-Anthropic ones) otherwise drift
  // into English mid-response. Covers reasoning + narration, not just final text.
  const locale = useI18nStore.getState().locale
  const lang = languageName(locale)
  parts.push(
    `\nCRITICAL — Response language: You MUST always respond in ${lang}. Every single message — including your reasoning, thinking, progress narration, plans, questions, and error messages — must be written in ${lang}. Never switch to English or any other language mid-response, and never reply in a different language than ${lang}, unless the user explicitly writes to you in another language or directly asks you to switch. The ONLY things that stay in their original form are: code, identifiers, variable/function/class names, file names, file paths, API endpoints, and established technical terms. If you catch yourself starting a sentence in the wrong language, stop and rewrite it in ${lang}.`,
  )

  // Progress narration — opt-out via settings.narrateProgress. When on, append
  // the general policy plus the model-family overlay (e.g. Kimi's firm nudge).
  // When off, neither is added, so the model works without narrating.
  const narrate = useSettingsStore.getState().settings.narrateProgress !== false
  if (narrate) {
    parts.push("\n" + NARRATION_POLICY)
    const overlay = FAMILY_OVERLAY[modelFamily(modelLabel)]
    if (overlay) parts.push("\n" + overlay)
  }

  // Brief Mode directive — placed near the top so the style rule frames every
  // later section (memory blocks, catalogs). Falls through cleanly when disabled.
  const brief = briefModeSection(tokenSavers?.briefMode)
  if (brief) parts.push("\n" + brief)

  if (workspacePath) {
    parts.push(`\nWorking directory: ${workspacePath}`)
    // Code Map routing — only meaningful with a repo attached.
    parts.push("\n" + CODE_NAVIGATION)
  }
  if (modelLabel) {
    parts.push(`Active model: ${modelLabel}`)
  }

  if (mode === "plan") {
    parts.push(
      "\n## PLAN MODE ACTIVE\n" +
        "You are in read-only mode. write_file/edit_file/bash/apply_patch are rejected — do not call them.\n" +
        "Work through the task in these steps:\n" +
        "1. Inspect the code — use the Code Map (code_search/code_callers/code_context) for structure, read_file/list_dir for contents, grep for literal text.\n" +
        "2. If anything is ambiguous, ask with the question tool.\n" +
        "3. Write the full implementation plan: which files, which changes, in what order.\n" +
        "4. Call propose_build with the full plan. When the user approves, the mode switches to build automatically — then implement exactly as approved.",
    )
  }

  if (mode === "build") {
    parts.push(
      "\n## PROACTIVE PLANNING\n" +
        "Before starting a non-trivial implementation, proactively call propose_plan to enter read-only plan mode and design an approach for the user to approve.\n" +
        "Prefer planning when the task is a new feature, touches multiple files, has more than one reasonable approach, requires an architectural decision, or the requirements are unclear.\n" +
        "Skip planning for simple, well-specified changes (a typo, a one-line fix, a single small function). When unsure, err on the side of proposing a plan.",
    )
  }

  const supervisorCatalog =
    (delegationMode ?? "solo") === "solo"
      ? ""
      : buildAgentRolesCatalog(
          useSettingsStore.getState().settings.supervisor ?? DEFAULT_SUPERVISOR_SETTINGS,
          session,
        )
  if (mode !== "plan" && supervisorCatalog) parts.push("\n" + supervisorCatalog)

  if (peers && peers.length > 0) {
    parts.push("\n" + buildPeerCatalog(peers, ownHandle))
  }

  if (mode !== "plan" && useSettingsStore.getState().settings.commitAttribution !== false) {
    parts.push(
      "\n## Git commits\n" +
        "When you create a git commit, the message must end with exactly ONE attribution trailer, after a blank line — the same byline the app's git panel adds:\n\n" +
        `${COMMIT_ATTRIBUTION_TRAILER}\n\n` +
        "Rules: copy that line verbatim, including the email `noreply@codezal.com`. " +
        "NEVER use `noreply@anthropic.com` or any other address or domain. " +
        "NEVER add more than one `Co-Authored-By` line. Before appending it, remove ANY " +
        "existing `Co-Authored-By:` line already in the message (yours or pre-existing) so " +
        "the commit never ends up with duplicate or wrong trailers. The app's git panel " +
        "normalizes this automatically, but shell (`git commit`) commits rely on you.",
    )
  }

  if (sddStage && sddRequirementPath) {
    parts.push("\n" + sddAssistantPreamble(sddStage, sddRequirementPath))
  }

  // Static memory only (priority preamble + rule files). Query-dependent recall
  // and the goal directive are emitted per-turn via buildDynamicContext().
  parts.push(...(await buildMemoryPromptSections({ workspacePath, memory, mode: "full" })))

  const skillsCatalog = await buildSkillsPromptSection(workspacePath, {
    disabledSkills: useSettingsStore.getState().settings.disabledSkills,
  })
  if (skillsCatalog) parts.push("\n" + skillsCatalog)

  // Agents katalogu (workspace + user + plugin)
  try {
    const [proj, user] = await Promise.all([
      readWorkspaceAgents(workspacePath),
      readUserAgents(),
    ])
    const catalog = buildAgentsCatalog([...proj, ...user, ...listPluginAgents()])
    if (catalog) parts.push("\n" + catalog)
  } catch {
    // Intentionally ignored.
  }

  if (deferredTools && deferredTools.length > 0) {
    const groups = new Map<string, string[]>()
    for (const name of deferredTools) {
      const idx = name.indexOf("__")
      const server = idx > 0 ? name.slice(0, idx) : "other"
      const arr = groups.get(server) ?? []
      arr.push(name)
      groups.set(server, arr)
    }
    const lines: string[] = [
      "\n## Deferred tools (load on demand)",
      `${deferredTools.length} MCP tools are connected but their input schemas are NOT loaded — to save tokens. To call one, FIRST load its schema with the \`tool_search\` tool:`,
      '- `tool_search({ query: "select:server__toolName" })` — load exact tool(s), comma-separated for several',
      '- `tool_search({ query: "keywords" })` — search by capability (e.g. "notebook list")',
      "After tool_search returns, the matched tools become callable on the next step. Available deferred tools by server:",
    ]
    for (const [server, names] of groups) {
      lines.push(`### ${server}`, names.map((n) => `- ${n}`).join("\n"))
    }
    parts.push(lines.join("\n"))
  }

  // MCP server-provided usage instructions — verbatim guidance from each
  // connected server's initialize response.
  const mcpInstr = buildMcpInstructionsBlock(mcpInstructions ?? [])
  if (mcpInstr) parts.push("\n" + mcpInstr)

  return parts.join("\n")
}
