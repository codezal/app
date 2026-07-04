import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import { pickSmallModel } from "@/lib/small-model"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import type { Settings } from "@/store/types"

const SYSTEM =
  "You are a prompt-improvement assistant. Rewrite the user's raw prompt so it is clearer, " +
  "more structured, and more actionable: preserve the intent, preserve the language the user " +
  "used, and make missing context reasonably explicit. Do not invent new requirements, add " +
  "assumptions, ask questions, or answer the prompt. Return only the improved prompt text: no " +
  "markdown fences, explanation, preface, or quotes."

function stripFence(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n").trim()
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(t)
  return m ? m[1].trim() : t
}

export async function enhancePrompt(args: {
  text: string
  providerId: ProviderId
  settings: Settings
  fallbackModel?: string
  signal?: AbortSignal
}): Promise<string> {
  const catalog = args.settings.providerCatalog?.data as ProvidersCatalog | undefined
  const modelId = pickSmallModel(catalog, args.providerId) ?? args.fallbackModel
  if (!modelId) throw new Error("No available model")

  const model = await buildLanguageModel({
    providerId: args.providerId,
    modelId,
    settings: args.settings,
  })
  // Gated providers (Kimi For Coding, Z.AI Coding) 403 bare generate calls.
  const gated = isCodingAgentGated(args.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined
  const result = streamText({
    model,
    system: SYSTEM,
    prompt: `Raw prompt:\n\n${args.text}\n\nImproved prompt:`,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
    abortSignal: args.signal,
  })
  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text ?? ""
  }
  return stripFence(text)
}
