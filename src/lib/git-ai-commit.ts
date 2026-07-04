import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import type { Settings } from "@/store/types"
import { gitDiffAll, gitDiffStaged } from "@/lib/git"

const SYSTEM =
  "Sen bir git commit mesajı yazarısın. Verilen staged diff için TEK bir kısa " +
  "Conventional Commits mesajı üret (örn `feat: ...`, `fix: ...`, `refactor: ...`). " +
  "Yalnız commit mesajını döndür — emir kipinde kısa başlık satırı, gerekiyorsa boş " +
  "satır + kısa gövde. Kod bloğu, sarmalayan tırnak veya açıklama YOK. Türkçe yaz."

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

  // Gated provider'lar (Kimi For Coding, Z.AI Coding vb.) bare generateText'i 403'ler;
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
  if (opts.settings.commitAttribution !== false) {
    return `${msg}\n\nCo-Authored-By: Codezal <noreply@codezal.com>`
  }
  return msg
}
