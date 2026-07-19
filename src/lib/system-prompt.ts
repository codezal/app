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
import { loadIndex, queryIndex } from "./semantic-index"
import { sliceCharsSafe } from "./text"
import { buildSkillsPromptSection } from "./skills"
import { readWorkspaceAgents, readUserAgents, buildAgentsCatalog } from "./agents"
import { listPluginAgents } from "./agents/plugin"
import type { OrchestraConfig } from "./orchestra/types"
import { briefModeSection } from "./token-savers"
import type { TokenSaverSettings } from "./token-savers/types"
import { useI18nStore, languageName } from "./i18n"
import { useSettingsStore } from "@/store/settings"
import { sddAssistantPreamble } from "./sdd-prompts"
import type { SddStage } from "@/store/types"
import type { SupervisorSettings } from "@/lib/agents/runtime"
import { DEFAULT_SUPERVISOR_SETTINGS } from "@/lib/agents/runtime/supervisor"

const BASE_SYSTEM = `You are Codezal — an interactive coding assistant running on the user's machine.
When the user gives you a task, use the available tools to make real changes — don't just describe a solution in text. Answer simple questions directly.

Guidelines:
- Summarize your plan in one or two sentences, then start calling tools.
- Read a file's current contents before editing it.
- For edit_file, include enough surrounding context that old_string is unique.
- Secrets: you CAN read secret files (.env, credential/key files) when a task genuinely needs them, but don't reach for them by default — prefer .env.example, config schemas, or docs first. Never print, echo, log, paste into summaries, or commit secret values; refer to a secret by name (e.g. "DATABASE_URL is set"), not by its value.
- Keep bash commands inside the workspace.
- When calling bash, ALWAYS pass a short \`description\` (5-10 words) of what the command does — it is shown as the title of the tool row in the UI. Write it in the user's language. Examples: "ls" → "Listed folder", "npm install" → "Installed dependencies", "npm run dev" → "Started dev server".
- Comment on a tool result briefly; don't repeat it when there is nothing to add.
- On a new project you may call repo_overview ONCE to orient — but do not reprint its output; acknowledge it in one sentence ("Checked the project overview.") and continue.
- If something is ambiguous or a critical decision is needed, don't assume — ask the user with the question tool (1-2 questions max, pick the critical ones).
- For multi-step tasks (3+ steps) write the plan up front with todo_write: send the full list (replace), keep exactly one item in_progress, mark items done as you finish them. Don't use it for simple single-step work.
- Finish the whole task before ending your turn. After a tool result, keep going with the next step — do NOT stop with the plan half-done. End your turn only when the task is fully complete (then give a one-line summary) or you genuinely need the user's input. Never end right after a tool result while work remains; if you announced a next step ("Now adding X"), actually perform it before stopping.`

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
const CODE_NAVIGATION = `## Code navigation — prefer the Code Map over grep for structure
This workspace has an always-indexed, auto-updated Code Map (a tree-sitter symbol graph). For STRUCTURAL questions it answers in ONE precise call and costs far fewer tokens than grepping then reading. Reach for it BEFORE grep:
- "Where is X defined / find a symbol named X" → code_search
- "What calls X / where is X used" → code_callers
- "What does X call" → code_callees
- "How does X reach Y / trace the flow" → code_trace
- "What breaks if I change X (rename, signature change)" → code_impact
- "Understand a symbol before editing it" → code_context (definition + callers + callees in one call)
- "Concept search — where's the auth / login / retry logic" (fuzzy, not a known name) → code_query (semantic; if it reports the index is off, fall back to grep)

Use grep ONLY for literal text the Code Map doesn't model: string contents, comments, log messages, config values — or a quick scan once you already have a file open. Do NOT grep for a symbol's callers or definition: that is slower, noisier, and misses dynamic-dispatch edges the Code Map bridges.
Trust Code Map results (full AST parse) — don't re-verify them with grep. The index stays fresh automatically; never rebuild it manually.`


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
  // GPT does well with commentary-style updates — frame them as what + why.
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
  mode?: "plan" | "build" | "orchestra"
  sddStage?: SddStage
  sddRequirementPath?: string
  orchestra?: OrchestraConfig
  // Token-saver toggles — when Brief Mode is enabled, an extra directive is
  // injected so the model responds in compressed style.
  tokenSavers?: TokenSaverSettings
  // Active persistent goal — when set, an autonomous-loop directive with the
  // [GOAL_DONE] sentinel is injected so the harness can decide whether to
  // auto-continue after each turn.
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
  recentText?: string
  delegationMode?: "inherit" | "solo" | "adaptive"
}

type MemoryPromptMode = "full" | "lean"

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
  const learnedBudget = lean
    ? Math.min(mem.memoryStoreBudgetTokens, 400)
    : mem.memoryStoreBudgetTokens

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

  if (mem.memoryStoreEnabled !== false) {
    try {
      const block = await loadMemoryContextBlock({
        workspace: args.workspacePath,
        now: Date.now(),
        query: args.recentText,
        budgetTokens: learnedBudget,
      })
      if (block) sections.push("\n" + block)
    } catch {
      // Learned-memory recall is best-effort.
    }

    try {
      const methodsBlock = await loadMethodsCatalog({
        workspace: args.workspacePath,
        query: args.recentText,
        now: Date.now(),
      })
      if (methodsBlock) sections.push("\n" + methodsBlock)
    } catch {
      // Method recall is best-effort.
    }
  }

  return sections.length === 1 ? [] : sections
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

function buildOrchestraCatalog(cfg: OrchestraConfig): string {
  const lines = [
    "## ORCHESTRA MODE ACTIVE",
    "You are an orchestra conductor — alongside your own tool loop you can dispatch parallel work to the worker pool.",
    "Available agents in the worker pool:",
    "",
  ]
  for (const w of cfg.workers) {
    const modelInfo =
      w.kind === "sdk"
        ? `${w.provider ?? "?"}/${w.model ?? "?"}`
        : `${w.kind} CLI${w.model ? ` (model hint: ${w.model})` : ""}`
    const yoloTag = w.yolo ? " · YOLO" : ""
    const presetTag = w.presetAgent ? ` · preset: ${w.presetAgent}` : ""
    lines.push(`- **worker-${w.idx}** (${modelInfo}${yoloTag}${presetTag})`)
  }
  lines.push("")
  lines.push(
    "For complex tasks, dispatch 1-5 workers in parallel with `dispatch_workers([{workerIdx, task}, ...])`. " +
      "The tool returns a status/output JSON per worker. You synthesize the results and dispatch again if needed.",
  )
  lines.push("")
  lines.push("### Dispatch discipline")
  lines.push(
    "- **Synthesize — never lazy-delegate.** When workers report findings, read and understand them yourself, then write the next task as a concrete spec (file paths, line numbers, exact change). Never write \"based on your findings\" — that hands your own thinking to the worker.",
  )
  lines.push(
    "- **Self-contained tasks.** Workers cannot see this conversation or each other. Every `task` string must carry all the context it needs: paths, signatures, error text, and what \"done\" looks like.",
  )
  lines.push(
    "- **Parallelize independent work**, but keep write-heavy tasks that touch the same files to one worker at a time.",
  )
  lines.push(
    "- **Verify by proof.** For non-trivial changes, dispatch a separate verifier worker that runs tests/typecheck and exercises edge cases — prove it works, don't just confirm it exists. Investigate failures; don't wave them off as unrelated.",
  )
  lines.push("")
  lines.push("Task spec — bad vs good:")
  lines.push("- Bad: \"Fix the bug we found\" · \"Based on the research, implement the fix\"")
  lines.push(
    "- Good: \"Fix the null deref in src/auth/validate.ts:42 — `user` is undefined when the session expires but the token is still cached. Add a null check before user.id; return 401 'Session expired'. Run the auth tests + typecheck, then report.\"",
  )
  return lines.join("\n")
}

function buildSupervisorCatalog(supervisor: SupervisorSettings): string {
  const entries = supervisor.pool.filter((entry) => entry.enabled)
  if (!supervisor.enabled || entries.length === 0) return ""
  const lines = [
    "## AVAILABLE AGENT POOL",
    "You may delegate independent subtasks with delegate_agents. Choose only pool entry ids listed here.",
    "Explicit user assignments override automatic routing. Synthesize all child results yourself.",
    "",
  ]
  for (const entry of entries) {
    const model = entry.engine.modelId ? `/${entry.engine.modelId}` : ""
    lines.push(`- **${entry.id}**: ${entry.agentName} · ${entry.engine.providerId}${model}`)
  }
  return lines.join("\n")
}

function buildPeerCatalog(
  peers: Array<{ title: string; handle: string }>,
  ownHandle?: string,
): string {
  const lines = [
    "## PEER SESSIONS",
    ownHandle
      ? `This session's handle is **@${ownHandle}** — other agents reach it with send_to_session({ to: "${ownHandle}", ... }).`
      : 'This session has no handle yet. Call set_session_handle({ handle: "..." }) so peers can address you.',
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

function buildWorkflowBlock(): string {
  return [
    "## DYNAMIC WORKFLOWS",
    "For a task that needs more agents than one conversation can coordinate — a codebase-wide audit/sweep, a large migration, research cross-checked across sources, or a hard plan worth drafting from several angles — you can author a JS orchestration script and run it with `run_workflow`.",
    "- The script's hooks (`agent`, `parallel`, `pipeline`, `log`, `phase`, `args`, `budget`, `workflow`) fan out subagents deterministically; intermediate results stay in script variables, not your context.",
    "- It runs in the BACKGROUND: `run_workflow` returns a runId immediately; poll `workflow_status({ runId, wait: true })` until it finishes, then synthesize the final result for the user.",
    "- Reach for it ONLY when the user explicitly asks for a workflow, OR when scale genuinely exceeds one conversation (codebase-wide sweep, large migration, multi-source cross-check). DEFAULT to `spawn_agent` or inline work. Do NOT spin up a workflow for an ordinary multi-step task just because the user said 'workflow' / 'batch' / 'pipeline' in passing — a single delegated subtask is `spawn_agent`'s job.",
  ].join("\n")
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
  orchestra,
  tokenSavers,
  activeGoal,
  memory,
  deferredTools,
  mcpInstructions,
  peers,
  ownHandle,
  recentText,
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

  // Active goal directive — placed before mode blocks so the autonomous-loop
  // protocol frames everything that follows.
  if (activeGoal) parts.push("\n" + buildGoalBlock(activeGoal))

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

  if (mode === "orchestra" && orchestra) {
    parts.push("\n" + buildOrchestraCatalog(orchestra))
  }

  const supervisorCatalog =
    (delegationMode ?? "solo") === "solo"
      ? ""
      : buildSupervisorCatalog(
          useSettingsStore.getState().settings.supervisor ?? DEFAULT_SUPERVISOR_SETTINGS,
        )
  if (mode !== "plan" && supervisorCatalog) parts.push("\n" + supervisorCatalog)

  if (peers && peers.length > 0) {
    parts.push("\n" + buildPeerCatalog(peers, ownHandle))
  }

  if (mode !== "plan" && useSettingsStore.getState().settings.commitAttribution !== false) {
    parts.push(
      "\n## Git commits\n" +
        "When you create a git commit, append this trailer as the LAST lines of the commit message, after a blank line — the same byline the app's git panel adds:\n\n" +
        "Co-Authored-By: Codezal <noreply@codezal.com>\n\n" +
        "Add it to every commit you author. If the message already ends with this exact trailer, don't duplicate it, and don't add any other co-author or attribution line.",
    )
  }

  if (sddStage && sddRequirementPath) {
    parts.push("\n" + sddAssistantPreamble(sddStage, sddRequirementPath))
  }

  // Opt-out: settings.disableWorkflows.
  if (mode !== "plan" && useSettingsStore.getState().settings.disableWorkflows !== true) {
    parts.push("\n" + buildWorkflowBlock())
  }

  parts.push(...(await buildMemoryPromptSections({ workspacePath, memory, recentText, mode: "full" })))

  const skillsCatalog = await buildSkillsPromptSection(workspacePath, {
    recentText,
    disabledSkills: useSettingsStore.getState().settings.disabledSkills,
  })
  if (skillsCatalog) parts.push("\n" + skillsCatalog)

  const sem = useSettingsStore.getState().settings.semantic
  if (sem?.enabled && sem.autoContext && workspacePath && (recentText?.trim().length ?? 0) >= 8) {
    try {
      const index = await loadIndex(workspacePath)
      if (index) {
        const hits = await queryIndex({
          index,
          cfg: { provider: sem.provider, baseUrl: sem.baseUrl, model: sem.model, apiKey: sem.apiKey },
          query: recentText!,
          topK: Math.min(sem.topK ?? 5, 6),
        })
        const relevant = hits.filter((h) => h.score > 0.2)
        if (relevant.length > 0) {
          const block: string[] = [
            "\n## Relevant code (auto-retrieved from the semantic index)",
            "Retrieved by similarity to the user's message — a starting point, not authoritative. Open the real files with read_file before editing.",
          ]
          let budget = 4000
          for (const h of relevant) {
            const snip =
              h.chunk.text.length > 1200
                ? sliceCharsSafe(h.chunk.text, 1200) + "\n… [truncated]"
                : h.chunk.text
            const entry = `\n### ${h.chunk.path}:${h.chunk.line0}-${h.chunk.line1}\n\`\`\`\n${snip}\n\`\`\``
            if (budget - entry.length < 0) break
            budget -= entry.length
            block.push(entry)
          }
          parts.push(block.join("\n"))
        }
      }
    } catch {
      // Intentionally ignored.
    }
  }

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
