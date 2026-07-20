import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import type { Settings } from "@/store/types"
import { gitDiffAll, gitDiffStaged } from "@/lib/git"
import { normalizeCommitAttribution } from "@/lib/commit-attribution"

const SYSTEM =
  "You write git commit messages. For the staged diff, produce exactly one short " +
  "Conventional Commits message (for example `feat: ...`, `fix: ...`, `refactor: ...`). " +
  "Return only the commit message: a short imperative subject line, and if needed a blank " +
  "line plus a brief body. Do not include code fences, wrapping quotes, or explanations. Write in English."

function clean(raw: string): string {
  let t = raw.trim()
  t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim()
  t = t.replace(/^["'`]+|["'`]+$/g, "").trim()
  return t
}

export async function generateCommitMessage(opts: {
  providerId: ProviderId
  modelId: string
  settings: Settings
  workspace: string
}): Promise<string | null> {
  let diff = await gitDiffStaged(opts.workspace)
  if (!diff.trim()) diff = await gitDiffAll(opts.workspace)
  if (!diff.trim() || diff.startsWith("# git diff")) return null

  const model = await buildLanguageModel({
    providerId: opts.providerId,
    modelId: opts.modelId,
    settings: opts.settings,
  })

  // Gated providers (Kimi For Coding, Z.AI Coding, etc.) 403 bare generateText;
  const gated = isCodingAgentGated(opts.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined

  const result = streamText({
    model,
    system: SYSTEM,
    prompt: `Staged diff:\n\n${diff}`,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
  })

  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text ?? ""
  }
  const msg = clean(text)
  if (!msg) return null
  return normalizeCommitAttribution(msg, opts.settings.commitAttribution !== false)
}
