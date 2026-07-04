//
// Strategy:
// 1) shouldCompact: effectiveContextTokens >= cap * (triggerPct/100) -> trigger
//

import { generateText, type ModelMessage } from "ai"
import type { ProviderId } from "./providers"
import { buildLanguageModel } from "./providers"
import { compactionModelFor, contextCap } from "./pricing"
import { pickSmallModel } from "./small-model"
import type { ProvidersCatalog } from "./providers-catalog"
import { estimateTextTokens } from "./tokens"
import type { AutoCompactSettings, Settings } from "@/store/types"

const PRUNE_PROTECT_TOKENS = 40_000
const PRUNE_MIN_GAIN = 20_000
const PRUNE_TAIL_TURNS = 2
const PRUNE_PLACEHOLDER = "[previous tool output removed to save context]"
const PER_TOOL_OVERHEAD = 12

export const RECENT_TOOL_PROTECT_TOKENS = 64_000

function isPrunedOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as Record<string, unknown>).value === PRUNE_PLACEHOLDER
  )
}

export type PruneOptions = {
  tailTurns?: number
  protectTokens?: number
  minGain?: number
}

export function pruneToolOutputs(
  messages: ModelMessage[],
  opts: PruneOptions = {},
): { messages: ModelMessage[]; prunedTokens: number } {
  const tailTurns = opts.tailTurns ?? PRUNE_TAIL_TURNS
  const protectTokens = opts.protectTokens ?? PRUNE_PROTECT_TOKENS
  const minGain = opts.minGain ?? PRUNE_MIN_GAIN

  const userIdx: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") userIdx.push(i)
  }
  const protectFrom =
    tailTurns <= 0
      ? messages.length
      : userIdx.length > tailTurns
        ? userIdx[userIdx.length - tailTurns]!
        : 0
  if (protectFrom === 0) return { messages, prunedTokens: 0 }

  let kept = 0
  let prunedTokens = 0
  let changed = false
  const out = messages.slice()

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (!Array.isArray(m.content)) continue
    const inTail = i >= protectFrom
    let msgChanged = false
    const content = m.content as Array<Record<string, unknown>>
    const newContent = content.slice()
    for (let j = content.length - 1; j >= 0; j--) {
      const p = content[j]!
      if (p.type !== "tool-result") continue
      if (isPrunedOutput(p.output)) continue
      const outStr = typeof p.output === "string" ? p.output : safeJson(p.output)
      const tok = estimateTextTokens(outStr) + PER_TOOL_OVERHEAD
      if (inTail || kept + tok <= protectTokens) {
        kept += tok
        continue
      }
      newContent[j] = { ...p, output: { type: "text", value: PRUNE_PLACEHOLDER } }
      prunedTokens += tok
      msgChanged = true
    }
    if (msgChanged) {
      out[i] = { ...m, content: newContent } as ModelMessage
      changed = true
    }
  }

  if (prunedTokens < minGain) return { messages, prunedTokens: 0 }
  return { messages: changed ? out : messages, prunedTokens }
}

const RESERVED_OUTPUT_TOKENS = 20_000

function usableContext(model: string, limits?: { context?: number; output?: number }): number {
  const window = limits?.context && limits.context > 0 ? limits.context : contextCap(model)
  const reserve = limits?.output && limits.output > 0 ? limits.output : RESERVED_OUTPUT_TOKENS
  return Math.max(0, window - reserve)
}

export function compactTrigger(
  model: string,
  settings: AutoCompactSettings,
  limits?: { context?: number; output?: number },
): number {
  return Math.floor(usableContext(model, limits) * (settings.triggerPct / 100))
}

export function shouldCompact(
  effectiveTokens: number,
  model: string,
  settings: AutoCompactSettings,
  limits?: { context?: number; output?: number },
): boolean {
  if (!settings.enabled) return false
  if (effectiveTokens <= 0) return false
  return effectiveTokens >= compactTrigger(model, settings, limits)
}

export function targetTokensAfterCompact(
  model: string,
  settings: AutoCompactSettings,
  limits?: { context?: number; output?: number },
): number {
  return Math.floor(usableContext(model, limits) * (settings.targetPct / 100))
}

export function resolveCompactModel(
  activeProvider: ProviderId,
  activeModel: string,
  override: string | undefined,
  catalog: ProvidersCatalog | undefined,
): { provider: ProviderId; model: string } {
  if (override && override.includes("/")) {
    const [p, m] = override.split("/", 2)
    return { provider: p as ProviderId, model: m }
  }
  const cm = compactionModelFor(activeProvider)
  if (cm.model) return { provider: cm.provider as ProviderId, model: cm.model }
  const small = pickSmallModel(catalog, activeProvider)
  if (small) return { provider: activeProvider, model: small }
  return { provider: activeProvider, model: activeModel }
}

const STRUCTURED_MEMORY_PROMPT = `Task: convert the following conversation history into a structured "memory" note using the EXACT HEADINGS below.
This memory lets the model continue the coding/agentic conversation without losing important context.

Output format (Markdown; preserve headings exactly; write "-" under an empty heading):

## Active Goals
- (tasks the user currently wants completed)

## Architecture Decisions
- (project structure, patterns, framework choices, file organization)

## Key Symbols and Files
- (frequently referenced function/class/file/endpoint names and brief descriptions)

## Open Issues
- (known bugs, failing tests, missing features)

## Active Files
- (files being actively worked on and their current status)

## User Rules and Preferences
- (style, technology, and behavior rules the user specified; do/don't items)

## Recent Actions
- (the assistant's 5-10 most important actions: what, which file, result)

RULES:
- Be factual; no filler.
- Do not preserve chat tone; write like a concise note.
- Include code snippets only when critical; otherwise reference long snippets as "file: X".
- Mark unresolved decisions with "?".
- Write in English.`

async function summarizeOldMessages(
  oldMessages: ModelMessage[],
  appSettings: Settings,
  activeProvider: ProviderId,
  activeModel: string,
  overrideModel: string | undefined,
  catalog: ProvidersCatalog | undefined,
  previousMemory?: string,
): Promise<{
  text: string
  usage: Awaited<ReturnType<typeof generateText>>["usage"]
  usedProvider: ProviderId
  usedModel: string
}> {
  const { provider, model } = resolveCompactModel(activeProvider, activeModel, overrideModel, catalog)
  const llm = await buildLanguageModel({ providerId: provider, modelId: model, settings: appSettings })

  const transcript = renderTranscript(oldMessages)

  const anchor = previousMemory
    ? `Below is a previously generated memory note. Your task is to UPDATE it with the new transcript.\n` +
      `- KEEP information that is still valid.\n- REMOVE or update information that is stale, contradicted, or completed.\n- ADD new facts.\n\n` +
      `<previous-summary>\n${previousMemory}\n</previous-summary>`
    : `Create a NEW memory note from the conversation history below.`

  const result = await generateText({
    model: llm,
    system: STRUCTURED_MEMORY_PROMPT,
    prompt: `${anchor}\n\nConversation transcript:\n\n${transcript}\n\nFill the template above.`,
  })
  return { text: result.text, usage: result.usage, usedProvider: provider, usedModel: model }
}

function extractPreviousMemory(content: string): string {
  const m = content.match(/<compacted-memory>\n[\s\S]*?\n\n([\s\S]*)\n<\/compacted-memory>/)
  return m ? m[1]!.trim() : ""
}

function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const role = m.role.toUpperCase()
    if (typeof m.content === "string") {
      lines.push(`[${role}] ${m.content}`)
      continue
    }
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as Record<string, unknown>
        if (typeof p.text === "string") {
          lines.push(`[${role}] ${p.text}`)
        } else if (p.type === "tool-call") {
          lines.push(`[${role}/tool-call ${String(p.toolName)}] ${safeJson(p.input)}`)
        } else if (p.type === "tool-result") {
          const out = typeof p.output === "string" ? p.output : safeJson(p.output)
          const trimmed = out.length > 2000 ? out.slice(0, 2000) + " …[trim]" : out
          lines.push(`[${role}/tool-result ${String(p.toolName)}] ${trimmed}`)
        } else if (typeof p.reasoning === "string") {
          lines.push(`[${role}/reasoning] ${p.reasoning}`)
        }
      }
    }
  }
  return lines.join("\n\n")
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ""
  } catch {
    return String(v ?? "")
  }
}

// Ana compaction fonksiyonu.
export async function compactMessages(args: {
  messages: ModelMessage[]
  appSettings: Settings
  activeProvider: ProviderId
  activeModel: string
  settings: AutoCompactSettings
}): Promise<{
  messages: ModelMessage[]
  memoryText: string
  usage?: Awaited<ReturnType<typeof generateText>>["usage"]
  usedProvider?: ProviderId
  usedModel?: string
}> {
  const { messages, appSettings, activeProvider, activeModel, settings } = args
  const catalog = appSettings.providerCatalog?.data as ProvidersCatalog | undefined
  const keepLast = Math.max(2, settings.keepLast)

  let previousMemory: string | undefined
  let body = messages
  const head = messages[0]
  if (
    head?.role === "system" &&
    typeof head.content === "string" &&
    head.content.includes("<compacted-memory>")
  ) {
    previousMemory = extractPreviousMemory(head.content) || undefined
    body = messages.slice(1)
  }

  if (body.length <= keepLast) {
    return { messages, memoryText: "" }
  }

  // assistant — olur; strict provider (Anthropic) "tool_result without tool_use" /
  const rawCutoff = body.length - keepLast
  let cutoff = rawCutoff
  while (cutoff > 0 && body[cutoff]!.role !== "user") cutoff--
  if (cutoff === 0 && body[0]!.role !== "user") {
    cutoff = rawCutoff
    while (cutoff < body.length && body[cutoff]!.role !== "user") cutoff++
  }
  const oldPart = body.slice(0, cutoff)
  const keepPart = body.slice(cutoff)

  if (oldPart.length === 0 || keepPart.length === 0) {
    return { messages, memoryText: "" }
  }

  const { text: memoryText, usage, usedProvider, usedModel } = await summarizeOldMessages(
    oldPart,
    appSettings,
    activeProvider,
    activeModel,
    settings.model,
    catalog,
    previousMemory,
  )

  const memoryMsg: ModelMessage = {
    role: "system",
    content:
      `<compacted-memory>\nThe structured note below summarizes ${oldPart.length} older messages. ` +
      `Use it as real context in the ongoing conversation.\n\n` +
      memoryText +
      `\n</compacted-memory>`,
  }

  return {
    messages: [memoryMsg, ...keepPart],
    memoryText,
    usage,
    usedProvider,
    usedModel,
  }
}
