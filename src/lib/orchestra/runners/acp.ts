import { useApprovalsStore } from "@/store/approvals"
import { AcpConnection } from "../acp/connection"
import {
  ACP_METHOD,
  ACP_PROTOCOL_VERSION,
  type InitializeResult,
  type NewSessionResult,
  type PermissionOption,
  type RequestPermissionParams,
  type RequestPermissionResult,
  type SessionUpdateParams,
} from "../acp/protocol"
import type { RunnerStart, WorkerDispatchResult, WorkerKind } from "../types"
import { errorMessage } from "@/lib/errors"
import { findAgent } from "../../agents"
import { useSettingsStore } from "@/store/settings"

const DEFAULT_ACP_COMMAND = "opencode acp"
export const CLAUDE_ACP_COMMAND = "npx -y @agentclientprotocol/claude-agent-acp"
export const CODEX_ACP_COMMAND = "npx -y @zed-industries/codex-acp"
export const KIMI_ACP_COMMAND = "kimi acp"
export const GEMINI_ACP_COMMAND = "gemini --experimental-acp"

const ACP_COMMAND_BY_KIND: Partial<Record<WorkerKind, string>> = {
  "opencode-cli": DEFAULT_ACP_COMMAND,
  "claude-cli": CLAUDE_ACP_COMMAND,
  "codex-cli": CODEX_ACP_COMMAND,
  "kimi-cli": KIMI_ACP_COMMAND,
  "gemini-cli": GEMINI_ACP_COMMAND,
}

function pickPermissionOption(
  options: PermissionOption[],
  decision: "allow" | "deny",
): string | null {
  const order =
    decision === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"]
  for (const kind of order) {
    const found = options.find((o) => o.kind === kind)
    if (found) return found.optionId
  }
  const re = decision === "allow" ? /allow/i : /reject|deny/i
  return options.find((o) => re.test(o.kind ?? "") || re.test(o.name ?? ""))?.optionId ?? null
}

export const startAcpWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workWorkspace,
  configWorkspace,
  emit,
  signal,
}) => {
  const startedAt = Date.now()

  if (config.yolo) {
    useApprovalsStore.getState().addBypassWorker(workerId)
  }

  const command = (ACP_COMMAND_BY_KIND[config.kind] ?? config.acpCommand?.trim()) || DEFAULT_ACP_COMMAND
  const workerLabel = config.label || `worker-${config.idx}`

  const conn = new AcpConnection({
    command,
    cwd: workWorkspace,
    onStderr: (line) => emit({ type: "log", line: `[stderr] ${line.trimEnd()}` }),
  })

  const toolNames = new Map<string, string>()
  let finalText = ""
  let tokensIn: number | undefined
  let tokensOut: number | undefined

  const cleanup = () => {
    if (config.yolo) useApprovalsStore.getState().removeBypassWorker(workerId)
    void conn.close()
  }

  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      let sessionId: string | undefined
      let cancelled = false

      const onAbort = () => {
        cancelled = true
        if (sessionId) void conn.notify(ACP_METHOD.cancel, { sessionId }).catch(() => {})
        void conn.close()
      }
      if (!signal.aborted) signal.addEventListener("abort", onAbort, { once: true })

      try {
        conn.onNotification(ACP_METHOD.sessionUpdate, (params) => {
          const u = (params as SessionUpdateParams | undefined)?.update
          if (!u) return
          switch (u.sessionUpdate) {
            case "agent_message_chunk": {
              const text = u.content?.text
              if (typeof text === "string" && text) {
                finalText += text
                emit({ type: "text-delta", delta: text })
              }
              break
            }
            case "tool_call": {
              const id = u.toolCallId
              const name = u.title || u.kind || "(tool)"
              if (id) toolNames.set(id, name)
              emit({ type: "tool-call", name, id })
              break
            }
            case "tool_call_update": {
              const status = u.status
              if (status === "completed" || status === "error" || status === "failed") {
                const id = u.toolCallId
                const name = (id && toolNames.get(id)) || "(tool)"
                emit({ type: "tool-result", name, id, isError: status !== "completed" })
              }
              break
            }
            case "usage_update": {
              const ti = u.inputTokens ?? u.promptTokens
              const to = u.outputTokens ?? u.completionTokens
              if (typeof ti === "number") tokensIn = ti
              if (typeof to === "number") tokensOut = to
              if (typeof ti === "number" || typeof to === "number") {
                emit({ type: "usage", tokensIn, tokensOut })
              }
              break
            }
            default:
              // agent_thought_chunk, plan, available_commands_update, … → ignore.
              break
          }
        })

        conn.onRequest(
          ACP_METHOD.requestPermission,
          async (params): Promise<RequestPermissionResult> => {
            const p = params as RequestPermissionParams
            const toolName = p?.toolCall?.title || p?.toolCall?.kind || "tool"
            emit({ type: "waiting-approval", toolName })
            const decision = await useApprovalsStore
              .getState()
              .request(toolName, p?.toolCall?.rawInput ?? {}, { workerId, workerLabel })
            const optionId = pickPermissionOption(p?.options ?? [], decision)
            if (optionId) return { outcome: { outcome: "selected", optionId } }
            return { outcome: { outcome: "cancelled" } }
          },
        )

        await conn.start()
        emit({ type: "started" })

        ;(await conn.request(ACP_METHOD.initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        })) as InitializeResult

        // "Authentication required"). gemini-api-key methodId non-interactive — gemini
        if (config.kind === "gemini-cli") {
          await conn
            .request(ACP_METHOD.authenticate, { methodId: "gemini-api-key" })
            .catch((e: unknown) => {
              emit({ type: "log", line: `[acp] gemini authenticate: ${errorMessage(e)}` })
            })
        }

        const sess = (await conn.request(ACP_METHOD.newSession, {
          cwd: workWorkspace ?? ".",
          mcpServers: [],
        })) as NewSessionResult
        sessionId = sess?.sessionId
        if (!sessionId) throw new Error("ACP session/new sessionId döndürmedi")

        if (config.model) {
          await conn
            .request(ACP_METHOD.setModel, { sessionId, modelId: config.model })
            .catch((e: unknown) => {
              emit({
                type: "log",
                line: `[acp] set_model başarısız: ${errorMessage(e)}`,
              })
            })
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

        // Preset agent (config.presetAgent ya da settings.defaultAgent fallback'i)
        let promptText = task
        const presetName = config.presetAgent ?? useSettingsStore.getState().settings.defaultAgent
        if (presetName) {
          try {
            const ag = await findAgent(configWorkspace, presetName)
            if (ag?.systemPrompt) promptText = `${ag.systemPrompt}\n\n---\n\n${task}`
          } catch {
            // Intentionally ignored.
          }
        }

        await conn.request(ACP_METHOD.prompt, {
          sessionId,
          prompt: [{ type: "text", text: promptText }],
        })

        if (signal.aborted || cancelled) {
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
        if (signal.aborted || cancelled) {
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
        const msg = errorMessage(e)
        emit({ type: "error", message: msg })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: "error",
          output: finalText,
          errorMessage: msg,
          durationMs: Date.now() - startedAt,
        })
      } finally {
        signal.removeEventListener("abort", onAbort)
        cleanup()
      }
    })()
  })

  return { done }
}
