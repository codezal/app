// SDK worker runner — buildModel + streamText + buildAllTools reuse.
// YOLO=true ise worker'ı bypassWorkerIds set'ine ekler; gate() global bypass kısa devresi
// üzerinden tool çağrılarını auto-approve eder.
import { streamText, stepCountIs } from "ai"
import { buildModel } from "../../providers"
import { buildAllTools } from "../../tools"
import { findAgent } from "../../agents"
import { useSettingsStore } from "@/store/settings"
import { useApprovalsStore } from "@/store/approvals"
import { makeToolCallRepair } from "../../tool-repair"
import type {
  RunnerStart,
  WorkerDispatchResult,
} from "../types"

const DEFAULT_SYSTEM = `Sen bir Codezal worker'ısın — sana verilen tek görevi araçlarla tamamla, kısa bir özetle final cevabını ver. Parent ajan seni dispatch etti, gereksiz konuşma yapma.`

export const startSdkWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workspacePath,
  emit,
  signal,
}) => {
  const settings = useSettingsStore.getState().settings

  // YOLO ise bypass set'ine ekle (worker süresince)
  if (config.yolo) {
    useApprovalsStore.getState().addBypassWorker(workerId)
  }

  const cleanup = () => {
    if (config.yolo) {
      useApprovalsStore.getState().removeBypassWorker(workerId)
    }
  }

  const startedAt = Date.now()
  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      try {
        // Provider/model fallback — config'de yoksa default settings
        const provider = config.provider ?? settings.defaultProvider
        const modelId = config.model ?? settings.defaultModel

        // System prompt — preset agent varsa onun, yoksa generic default
        let systemPrompt = DEFAULT_SYSTEM
        if (config.presetAgent) {
          const ag = await findAgent(workspacePath, config.presetAgent)
          if (ag) systemPrompt = ag.systemPrompt
        }

        const model = buildModel(provider, modelId, settings.apiKeys)
        // Tool seti — aynı buildAllTools (worker da MCP dahil tam set görür).
        // Approval gate'i global bypass set'i üzerinden YOLO'yu okur.
        const tools = await buildAllTools(workspacePath, settings.mcpServers ?? [])

        emit({ type: "started" })

        const result = streamText({
          model,
          system: systemPrompt,
          messages: [{ role: "user", content: task }],
          tools,
          stopWhen: stepCountIs(40),
          abortSignal: signal,
          experimental_repairToolCall: makeToolCallRepair(),
          onError: ({ error }) => {
            // text-delta loop catch zaten kapsıyor, log da yapalım
            console.error(`[sdk-worker ${workerId}] stream error:`, error)
          },
        })

        let finalText = ""
        for await (const chunk of result.fullStream) {
          if (signal.aborted) break
          switch (chunk.type) {
            case "text-delta": {
              const delta = chunk.text ?? ""
              if (delta) {
                finalText += delta
                emit({ type: "text-delta", delta })
              }
              break
            }
            case "tool-call":
              emit({
                type: "tool-call",
                name: chunk.toolName,
                id: chunk.toolCallId,
              })
              break
            case "tool-result":
              emit({
                type: "tool-result",
                name: chunk.toolName,
                id: chunk.toolCallId,
              })
              break
            case "error": {
              const err = chunk.error
              const msg = err instanceof Error ? err.message : String(err)
              throw new Error(msg)
            }
            case "finish":
              // Usage chunk değil — usage Promise üzerinden alınır
              break
          }
        }

        // Final usage
        let tokensIn: number | undefined
        let tokensOut: number | undefined
        try {
          const usage = await result.usage
          if (usage) {
            tokensIn = usage.inputTokens ?? undefined
            tokensOut = usage.outputTokens ?? undefined
            emit({ type: "usage", tokensIn, tokensOut })
          }
        } catch {
          // sessiz geç
        }

        if (signal.aborted) {
          emit({ type: "aborted" })
          resolve({
            workerIdx: config.idx,
            workerId,
            status: "aborted",
            output: finalText,
            tokensIn,
            tokensOut,
            durationMs: Date.now() - startedAt,
          })
          return
        }

        emit({ type: "complete", text: finalText })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: "done",
          output: finalText || "(boş cevap)",
          tokensIn,
          tokensOut,
          durationMs: Date.now() - startedAt,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emit({ type: "error", message: msg })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: signal.aborted ? "aborted" : "error",
          output: "",
          errorMessage: msg,
          durationMs: Date.now() - startedAt,
        })
      } finally {
        cleanup()
      }
    })()
  })

  return { done }
}
