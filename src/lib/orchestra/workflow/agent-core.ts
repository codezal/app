//
import { streamText, generateText, generateObject, jsonSchema, stepCountIs } from "ai"
import type { ToolSet } from "ai"
import { buildLanguageModel, type ProviderId } from "../../providers"
import { buildAllTools } from "../../tools"
import { findAgent } from "../../agents"
import { makeToolCallRepair } from "../../tool-repair"
import { useSettingsStore } from "@/store/settings"
import { errorMessage } from "@/lib/errors"
import type { WorkerEvent } from "../types"

const DEFAULT_WORKFLOW_SYSTEM = `Sen bir Codezal workflow ajanısın. Sana verilen tek görevi araçlarla tamamla ve final cevabını üret.

Disiplin:
- Final cevabın DÖNÜŞ DEĞERİDİR — bir workflow script'i onu programatik kullanır, kullanıcıya gösterilmez. Gevezelik/selamlama yok; sadece istenen veriyi/özeti döndür.
- Kök nedeni çöz, semptomu değil.
- Kod değiştirdiysen rapor etmeden önce kendin doğrula (test + tip kontrolü).
- Bir schema istendiyse cevabın tam o schema'ya uymalı.`

const FORBIDDEN_AGENT_TOOLS = new Set([
  "spawn_agent",
  "dispatch_workers",
  "run_workflow",
  "workflow_status",
])

export type AgentModelOverride = { provider: ProviderId; modelId: string }

export type AgentCoreInput = {
  prompt: string
  workWorkspace?: string
  configWorkspace?: string
  ownerId: string
  model?: AgentModelOverride
  agentType?: string
  systemPrompt?: string
  tools?: ToolSet
  schema?: unknown
  maxSteps?: number
  emit: (ev: WorkerEvent) => void
  signal: AbortSignal
}

export type AgentCoreResult = {
  text: string
  structured?: unknown
  tokensIn?: number
  tokensOut?: number
}

export async function runAgentInline(input: AgentCoreInput): Promise<AgentCoreResult> {
  const settings = useSettingsStore.getState().settings

  const preset = input.agentType
    ? await findAgent(input.configWorkspace, input.agentType)
    : null

  const provider = (input.model?.provider ??
    (preset?.provider as ProviderId | undefined) ??
    settings.defaultProvider) as ProviderId
  const modelId = input.model?.modelId ?? preset?.model ?? settings.defaultModel
  if (!provider || !modelId) {
    throw new Error("Workflow ajanı: provider/model belirlenemedi")
  }

  const systemPrompt = preset?.systemPrompt ?? input.systemPrompt ?? DEFAULT_WORKFLOW_SYSTEM

  const model = await buildLanguageModel({ providerId: provider, modelId, settings })

  let tools = input.tools
  if (!tools) {
    const full = await buildAllTools(
      input.workWorkspace,
      settings.mcpServers ?? [],
      input.ownerId,
      input.configWorkspace,
    )
    tools = {}
    for (const [k, t] of Object.entries(full)) {
      if (!FORBIDDEN_AGENT_TOOLS.has(k)) tools[k] = t
    }
  }

  input.emit({ type: "started" })

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: input.prompt }],
    tools,
    stopWhen: stepCountIs(input.maxSteps ?? 40),
    abortSignal: input.signal,
    experimental_repairToolCall: makeToolCallRepair(),
  })

  let finalText = ""
  for await (const chunk of result.fullStream) {
    if (input.signal.aborted) break
    switch (chunk.type) {
      case "text-delta": {
        const delta = chunk.text ?? ""
        if (delta) {
          finalText += delta
          input.emit({ type: "text-delta", delta })
        }
        break
      }
      case "tool-call":
        input.emit({ type: "tool-call", name: chunk.toolName, id: chunk.toolCallId })
        break
      case "tool-result":
        input.emit({ type: "tool-result", name: chunk.toolName, id: chunk.toolCallId })
        break
      case "tool-error":
        input.emit({ type: "tool-result", name: chunk.toolName, id: chunk.toolCallId, isError: true })
        break
      case "error":
        throw new Error(errorMessage(chunk.error))
    }
  }

  let tokensIn: number | undefined
  let tokensOut: number | undefined
  try {
    const usage = await result.usage
    if (usage) {
      tokensIn = usage.inputTokens ?? undefined
      tokensOut = usage.outputTokens ?? undefined
    }
  } catch {
    // Intentionally ignored.
  }

  let text = finalText.trim()
  if (!text && !input.signal.aborted) {
    try {
      const resp = await result.response
      const wrap = await generateText({
        model,
        messages: [
          ...resp.messages,
          { role: "user", content: "Bulgularını final cevap olarak özetle." },
        ],
      })
      text = wrap.text.trim()
    } catch {
      // Intentionally ignored.
    }
  }

  let structured: unknown
  if (input.schema && !input.signal.aborted) {
    try {
      const obj = await generateObject({
        model,
        schema: jsonSchema(input.schema as Parameters<typeof jsonSchema>[0]),
        messages: [
          {
            role: "user",
            content: `Aşağıdaki görev sonucunu istenen şemaya tam uyacak şekilde yapılandır.\n\nGörev: ${input.prompt}\n\nSonuç:\n${text || "(boş)"}`,
          },
        ],
      })
      structured = obj.object
      if (obj.usage) {
        tokensIn = (tokensIn ?? 0) + (obj.usage.inputTokens ?? 0)
        tokensOut = (tokensOut ?? 0) + (obj.usage.outputTokens ?? 0)
      }
    } catch (e) {
      throw new Error(`Schema coercion başarısız: ${errorMessage(e)}`, { cause: e })
    }
  }

  if (tokensIn !== undefined || tokensOut !== undefined) {
    input.emit({ type: "usage", tokensIn, tokensOut })
  }

  if (input.signal.aborted) {
    input.emit({ type: "aborted" })
    return { text, structured, tokensIn, tokensOut }
  }

  if (!text) text = "(workflow ajanı boş cevap döndürdü)"
  input.emit({ type: "complete", text })
  return { text, structured, tokensIn, tokensOut }
}
