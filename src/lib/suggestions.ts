// Post-run next-task suggestions — after a run finishes, a cheap model proposes
// 3-4 repo-grounded next steps (Ara-style). Same one-shot LLM approach as
// git-ai-commit.ts: NOT an agent turn, just a direct AI SDK call on the session's
// (small) model. Grounded in real signals so suggestions are a "dangling-work
// launcher", not generic brainstorm.
import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import { pickSmallModel } from "@/lib/small-model"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { gitStatus } from "@/lib/git"
import { useI18nStore, languageName } from "@/lib/i18n"
import type { Settings } from "@/store/types"

export type Suggestion = {
  id: string
  title: string
  rationale: string
  // Full, self-contained task to dispatch as a new message when the card is run.
  prompt: string
  // 0-4 relevant repo-relative paths (may be empty).
  files?: string[]
}

// Hard cap on a single generation — this fires automatically after every run, so
// a hung/slow model must not leave the store stuck in `loading` forever (which
// would block all future suggestions for that session via single-flight). On
// timeout the abort propagates out → the store's catch clears loading + sets error.
const GEN_TIMEOUT_MS = 20_000

const SYSTEM =
  "You are a coding copilot that proposes the user's most valuable NEXT tasks after a work session. " +
  "Ground every suggestion in CONCRETE signals from the provided context — prioritize dangling work: " +
  "uncommitted/staged changes, unfinished or in-progress todos, an interrupted goal, failing tests or " +
  "errors mentioned in the transcript. Do NOT invent generic ideas (\"add more tests\", \"improve docs\") " +
  "unless the context clearly points to them.\n\n" +
  "Return ONLY a JSON array of 3-4 objects — no prose, no code fences. Each object:\n" +
  '{ "title": string (<=6 words, imperative), "rationale": string (one short sentence: why now, citing the signal), ' +
  '"prompt": string (the full self-contained task to run as a new message), "files": string[] (0-4 repo-relative paths, may be empty) }\n' +
  "Write title, rationale and prompt in the language specified in the user message. " +
  "If there is no meaningful next work, return []."

// Compact a GitStatus into a short, token-bounded grounding block.
async function gitBlock(workspace: string | undefined): Promise<string> {
  if (!workspace) return "no workspace"
  try {
    const st = await gitStatus(workspace)
    if (!st.isRepo) return "not a git repo"
    if (st.info.clean) return `clean (branch ${st.info.branch ?? "?"})`
    const staged: string[] = []
    const modified: string[] = []
    const untracked: string[] = []
    for (const e of st.entries) {
      if (e.index === "?") untracked.push(e.path)
      else if (e.index !== " ") staged.push(e.path)
      else if (e.worktree !== " ") modified.push(e.path)
    }
    const cap = (xs: string[]) => xs.slice(0, 20).join(", ") + (xs.length > 20 ? `, +${xs.length - 20} more` : "")
    const parts: string[] = [`branch ${st.info.branch ?? "?"}`]
    if (staged.length) parts.push(`staged (${staged.length}): ${cap(staged)}`)
    if (modified.length) parts.push(`modified (${modified.length}): ${cap(modified)}`)
    if (untracked.length) parts.push(`untracked (${untracked.length}): ${cap(untracked)}`)
    return parts.join("\n")
  } catch {
    return "git status unavailable"
  }
}

// Tolerant JSON-array parse → Suggestion[]. Exported for unit tests: strips code
// fences, extracts the outermost [...] span, parses, normalizes fields, drops
// invalid rows, caps at 4. Never throws — bad input yields [].
export function parseSuggestions(raw: string): Suggestion[] {
  let t = (raw ?? "").trim()
  // Strip a leading ```json / ``` fence and trailing fence if present.
  t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim()
  // Extract the outermost array span so surrounding prose is ignored.
  const start = t.indexOf("[")
  const end = t.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(t.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Suggestion[] = []
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const title = typeof r.title === "string" ? r.title.trim() : ""
    const prompt = typeof r.prompt === "string" ? r.prompt.trim() : ""
    // Title + prompt are the load-bearing fields; skip rows missing either.
    if (!title || !prompt) continue
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : ""
    const files = Array.isArray(r.files)
      ? r.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0).slice(0, 4)
      : undefined
    out.push({ id: `sug-${out.length}`, title, prompt, rationale, files })
    if (out.length >= 4) break
  }
  return out
}

// Generate next-step suggestions for a just-finished run. Returns [] on any
// failure (caller treats empty as "no suggestions"). Uses the provider's cheap
// model when one exists, else falls back to the session's active model.
export async function generateSuggestions(opts: {
  providerId: ProviderId
  modelId: string
  settings: Settings
  workspace?: string
  catalog?: ProvidersCatalog
  // Rendered transcript tail (caller truncates) — the recent conversation.
  recentMessages: string
  goal?: string
  todos?: string
}): Promise<Suggestion[]> {
  const modelId = pickSmallModel(opts.catalog, opts.providerId) ?? opts.modelId
  const model = await buildLanguageModel({
    providerId: opts.providerId,
    modelId,
    settings: opts.settings,
  })

  const lang = languageName(useI18nStore.getState().locale)
  const git = await gitBlock(opts.workspace)
  const prompt =
    `<git-status>\n${git}\n</git-status>\n` +
    `<goal>${opts.goal?.trim() || "—"}</goal>\n` +
    `<todos>${opts.todos?.trim() || "—"}</todos>\n` +
    `<recent-conversation>\n${opts.recentMessages.trim() || "—"}\n</recent-conversation>\n\n` +
    `Propose the 3-4 most valuable next tasks as the JSON array.\n` +
    `IMPORTANT: Write the "title", "rationale" and "prompt" fields in ${lang}, regardless of the language used in the context above.`

  // Gated providers (Kimi For Coding, Z.AI Coding…) 403 a bare generateText; the
  // request must look "agent-like" (streaming + tools). Dummy noop tool +
  // toolChoice:"none" passes the gate but still returns plain text. (git-ai-commit.ts)
  const gated = isCodingAgentGated(opts.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined

  const result = streamText({
    model,
    system: SYSTEM,
    prompt,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
    abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  })

  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text ?? ""
  }
  return parseSuggestions(text)
}
