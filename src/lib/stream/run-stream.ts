// transient API retry ve goal sentinel-loop.
//
import { streamText, generateText, isStepCount, smoothStream, type ModelMessage } from "ai"
import { pendingScreenshots } from "@/lib/browser"
import type { SendOverride } from "@/lib/stream/types"
import {
  buildLanguageModel,
  transformHistory,
  buildProviderOptions,
  resolveReasoningEffort,
  maxOutputTokens,
  parseStreamError,
  isRetryableError,
  isContentFilterError,
  retryDelayMs,
  stallRetryDelayMs,
  stripImageParts,
  type ProviderId,
  type ReasoningEffort,
} from "@/lib/providers"
import { inlinesThinkTags } from "@/lib/providers/provider-quirks"
import { createThinkSplitter } from "@/lib/stream/think-split"
import {
  createVisibleToolProtocolFilter,
  shouldStripVisibleToolProtocol,
  stripVisibleToolProtocolMessages,
} from "@/lib/stream/tool-protocol-filter"
import { detectStopReason, isUserWaitingTool } from "@/lib/stream/stop-reason"
import { needsCompletionNudge, COMPLETION_NUDGE_TEXT } from "@/lib/stream/completion-guard"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { modelDetail, resolveContextCap, catalogPricing, modelAcceptsImages } from "@/lib/providers-catalog"
import { resolveLocalLlm } from "@/lib/local-llm"
import { logError } from "@/lib/error-log"
import { useLocalRuntimeStore } from "@/store/local-runtime"
import { lastToolBeat } from "@/lib/tool-heartbeat"
import { applyModelToolPolicy, buildAllTools, deferredToolNames, makeToolSearchTool, resetDoomLoop, TOOL_SEARCH_NAME } from "@/lib/tools"
import { listConnectedMcpInstructions } from "@/lib/mcp"
import { buildBackgroundJobsNote } from "@/lib/stream/background-note"
import { useJobsStore } from "@/store/jobs"
import { buildMemoryPromptSections, buildSystemPrompt } from "@/lib/system-prompt"
import { buildSkillsPromptSection } from "@/lib/skills"
import { PrivacyScrubber, privacyActive } from "@/lib/privacy"

function lastUserText(history: ModelMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== "user") continue
    if (typeof m.content === "string") return m.content || undefined
    if (Array.isArray(m.content)) {
      const txt = m.content
        .filter((p) => (p as { type?: string }).type === "text")
        .map((p) => (p as { text?: string }).text ?? "")
        .join(" ")
        .trim()
      return txt || undefined
    }
  }
  return undefined
}
import { useSddStore } from "@/store/sdd"
import { sddRequirementPath } from "@/lib/sdd-store"
import { compactToolDescriptionsInPlace, applyHistoryHygiene } from "@/lib/token-savers"
import { recordSavings } from "@/store/token-savings"
import { costUsd } from "@/lib/pricing"
import { compactMessages, pruneToolOutputs, RECENT_TOOL_PROTECT_TOKENS } from "@/lib/compact"
import { estimateMessagesTokens, estimateTextTokens } from "@/lib/tokens"
import { runHooks } from "@/lib/hooks"
import { makeToolCallRepair, looksLikeQuotedSyntax } from "@/lib/tool-repair"
import { setStreamAbort, clearStreamAbort } from "@/lib/run-registry"
import { toast } from "@/store/toast"
import { insertToFocusedComposer } from "@/lib/composer-drop"
import { useSessionsStore } from "@/store/sessions"
import { useQuestionsStore } from "@/store/questions"
import { useSettingsStore } from "@/store/settings"
import { resolveEffectiveSettings, getEffectiveSettings } from "@/lib/config"
import type { ContextBreakdown, Message, Part } from "@/store/types"
import { t as tStatic } from "@/lib/i18n"
import { createId } from "@/lib/id"
import { hasInbox, takeInbox, framePeerMessage, listPeers } from "@/lib/session-inbox"
import { errorMessage } from "@/lib/errors"
import { isCliAgentProvider } from "@/lib/agent-providers"
import { runNativeAgentStream } from "@/lib/agent-providers/native-stream"

const MAX_API_RETRIES = 5

export interface RunStreamDeps {
  // sid-aware: a background/queued stream's error must land on its own session's
  // banner, never leak into whichever session the user is currently viewing.
  // `null` clears the banner only when it belongs to `sid`.
  setError: (e: string | null, sid: string) => void
  recordAuxUsage: (
    sid: string,
    usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined,
    prov: ProviderId,
    mdl: string,
  ) => void
  sanitizeHistoryForProvider: (history: ModelMessage[]) => ModelMessage[]
}

export function stripSuppressedToolMessages(
  messages: ModelMessage[],
  ids: Set<string>,
): ModelMessage[] {
  if (ids.size === 0) return messages
  const out: ModelMessage[] = []
  for (const m of messages) {
    if ((m.role === "assistant" || m.role === "tool") && Array.isArray(m.content)) {
      const parts = m.content as Array<{ type: string; toolCallId?: string }>
      const kept = parts.filter(
        (p) =>
          !(
            (p.type === "tool-call" || p.type === "tool-result") &&
            typeof p.toolCallId === "string" &&
            ids.has(p.toolCallId)
          ),
      )
      if (kept.length === 0) continue
      if (kept.length !== parts.length) {
        out.push({ ...m, content: kept } as ModelMessage)
        continue
      }
    }
    out.push(m)
  }
  return out
}

export function makeRunStream(deps: RunStreamDeps) {
  function stringifyToolOutput(out: unknown): string {
    if (typeof out === "string") return out
    if (out && typeof out === "object" && "value" in out) {
      const v = (out as { value: unknown }).value
      return typeof v === "string" ? v : JSON.stringify(v, null, 2)
    }
    return JSON.stringify(out, null, 2)
  }

  function collapseText(parts: Part[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n")
  }

  async function runStream(
    sid: string,
    asstMsgId: string,
    history: ModelMessage[],
    override?: SendOverride,
    retryCount = 0,
    apiRetryCount = 0,
    autoContinueCount = 0,
    completionNudged = false,
  ) {
    const cur = useSessionsStore.getState().sessions[sid]
    if (!cur) return
    const settings = useSettingsStore.getState().settings
    // Single-flight safety net. Normal sends are gated upstream (turn-gate in
    // dispatchTurn) and never reach this — hitting it means a caller bypassed
    // the gate, so make it loud instead of silently dropping the turn.
    if (useSessionsStore.getState().streamingIds[sid]) {
      console.warn(`[runStream] dropped turn for ${sid} — a stream is already in flight (gate bypassed)`)
      return
    }
    const spendCap = settings.sessionSpendCapUsd ?? 0
    if (spendCap > 0 && (cur.usage?.costUsd ?? 0) >= spendCap) {
      const note = tStatic("app.spendCapReached", { cap: spendCap.toFixed(2) })
      useSessionsStore
        .getState()
        .patchMessageFor(sid, asstMsgId, { pending: false, content: note, parts: [{ type: "text", text: note }], endedAt: Date.now() })
      return
    }
    // Per-turn override (slash command `model:` frontmatter); session stays unchanged.
    const provider = override?.provider ?? cur.provider
    const modelId = override?.model ?? cur.model
    const localStatsProvider = provider === "local" || provider === "mlx"
    const localRuntimeProvider = provider === "local" || provider === "mlx"
    // Local agent mode (per-model profil → global default localLlm, default ON):
    // local models get the shared lean tool core + tool_search and run a multi-step
    // tool loop, so they can explore the project. Off → clean single-turn chat.
    const localAgent = localRuntimeProvider && resolveLocalLlm(settings, modelId).agentMode
    const ac = new AbortController()
    setStreamAbort(sid, ac)
    useSessionsStore.getState().setStreamingFor(sid, true)
    if (localStatsProvider) useLocalRuntimeStore.getState().setLastStats(null)
    const patchFor = (mid: string, p: Partial<Message>) =>
      useSessionsStore.getState().patchMessageFor(sid, mid, p)

    const parts: Part[] = []
    // Filled in once the run finishes (inside the try block) so the post-run
    // auto-continue / background-toast logic below the try/catch/finally can
    // see whether the turn ended prematurely (step-cap / early truncation).
    let finalStopReason: Message["stopReason"] = undefined
    let textBuf = ""
    let reasoningBuf = ""
    let protocolTextFilter: ReturnType<typeof createVisibleToolProtocolFilter> | null = null
    let rafId: number | null = null
    let flushTimerId: ReturnType<typeof setTimeout> | null = null
    let pendingPatch = false
    let unscrub: ((s: string) => string) | null = null

    const computePatch = () => {
      const next = [...parts]
      if (reasoningBuf) next.push({ type: "reasoning", text: unscrub ? unscrub(reasoningBuf) : reasoningBuf })
      if (textBuf) next.push({ type: "text", text: unscrub ? unscrub(textBuf) : textBuf })
      return { parts: next, content: collapseText(next) }
    }
    const flushNow = () => {
      rafId = null
      if (flushTimerId !== null) {
        clearTimeout(flushTimerId)
        flushTimerId = null
      }
      pendingPatch = false
      patchFor(asstMsgId, computePatch())
    }
    const cancelRaf = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (flushTimerId !== null) {
        clearTimeout(flushTimerId)
        flushTimerId = null
      }
      pendingPatch = false
    }
    const schedulePatch = () => {
      if (pendingPatch) return
      pendingPatch = true
      rafId = requestAnimationFrame(flushNow)
      // rAF callbacks are suspended while the window is occluded or the app is
      // napped (e.g. the user switched to another app) and the missed callback
      // is NOT replayed on refocus. Relying on rAF alone would leave
      // `pendingPatch` stuck true — every later schedulePatch early-returns and
      // no patch reaches the store, so the message list freezes (while side
      // stores like todos / write-diffs, which bypass rAF, keep updating). A
      // timer, unlike rAF, fires its pending callback on resume, releasing the
      // lock; it also keeps updates flowing (throttled) while backgrounded.
      flushTimerId = setTimeout(flushNow, 200)
    }
    const syncFlush = () => {
      cancelRaf()
      patchFor(asstMsgId, computePatch())
    }
    const flushText = () => {
      if (!textBuf) return
      parts.push({ type: "text", text: unscrub ? unscrub(textBuf) : textBuf })
      textBuf = ""
    }
    const appendText = (s: string) => {
      const text = protocolTextFilter ? protocolTextFilter.feed(s) : s
      if (text) textBuf += text
    }
    const flushProtocolText = () => {
      const text = protocolTextFilter?.flush() ?? ""
      if (text) textBuf += text
    }
    const flushReasoning = () => {
      if (!reasoningBuf) return
      parts.push({ type: "reasoning", text: unscrub ? unscrub(reasoningBuf) : reasoningBuf })
      reasoningBuf = ""
    }

    const thinkSplitter = inlinesThinkTags(provider, modelId)
      ? createThinkSplitter({
          onText: (s) => {
            if (reasoningBuf) flushReasoning()
            appendText(s)
          },
          onReasoning: (s) => {
            flushProtocolText()
            if (textBuf) flushText()
            reasoningBuf += s
          },
        })
      : null

    let streamSucceeded = false
    let overflowDetected = false
    let retryPending = false
    let retryDelay = 0
    let retryMessage = ""
    let streamStalled = false
    let streamTruncated = false
    let stallWatchdog: ReturnType<typeof setInterval> | undefined
    let streamResult: ReturnType<typeof streamText> | undefined

    const effCtxWindow = resolveContextCap(
      settings.providerCatalog?.data as ProvidersCatalog | undefined,
      provider,
      modelId,
      resolveLocalLlm(settings, modelId).contextWindow,
      settings.customProviders,
    )
    const maxReadChars = Math.floor(effCtxWindow * 4 * 0.4)
    const protectBudget = Math.min(RECENT_TOOL_PROTECT_TOKENS, Math.floor(effCtxWindow * 0.5))

    try {
      if (isCliAgentProvider(provider)) {
        await runNativeAgentStream({
          sid,
          asstMsgId,
          history,
          signal: ac.signal,
          settings,
          session: cur,
          provider,
          modelId,
        })
        streamSucceeded = true
      } else {
      // Effective settings = global merged with this workspace's project config
      // override (mcpServers/hooks concat). Auth keys stay global, so the model
      // build still reads the global `settings`.
      const eff = await resolveEffectiveSettings(cur.workspacePath)
      const model = await buildLanguageModel({
        providerId: provider,
        modelId: modelId,
        settings,
      })
      if (retryCount === 0 && apiRetryCount === 0) resetDoomLoop(sid)
      const tools = await buildAllTools(
        cur.workspacePath,
        eff.mcpServers ?? [],
        sid,
        undefined,
        maxReadChars,
        localRuntimeProvider ? 400 : undefined,
      )
      // Tailor editing tools to the model (apply_patch vs edit/write) — opencode parity.
      applyModelToolPolicy(tools, modelId)
      if (override?.disallowedTools?.length) {
        for (const pat of override.disallowedTools) {
          if (pat.includes("*")) {
            const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
            for (const name of Object.keys(tools)) if (re.test(name)) delete tools[name]
          } else if (tools[pat]) {
            delete tools[pat]
          }
        }
      }
      const deferMcp = settings.tokenSavers?.deferMcpTools !== false
      // Lean core (+ tool_search) is active for every model; everything else is
      // deferred and discovered via tool_search.
      const deferred = deferMcp ? deferredToolNames(tools) : []
      const activeSet = new Set<string>()
      let initialActiveTools: string[] | null = null
      if (deferred.length > 0) {
        const deferredSet = new Set(deferred)
        for (const n of Object.keys(tools)) if (!deferredSet.has(n)) activeSet.add(n)
        activeSet.add(TOOL_SEARCH_NAME)
        tools[TOOL_SEARCH_NAME] = makeToolSearchTool(tools, deferred, activeSet)
        initialActiveTools = [...activeSet]
      }
      const CODE_INTEL_TOOLS = [
        "code_search",
        "code_query",
        "code_callers",
        "code_callees",
        "code_trace",
        "code_impact",
      ]
      const localCodeIntel =
        localRuntimeProvider && localAgent ? CODE_INTEL_TOOLS.filter((n) => tools[n]) : []
      if (initialActiveTools && localCodeIntel.length > 0) {
        for (const n of localCodeIntel) activeSet.add(n)
        initialActiveTools = [...activeSet]
      }
      if (settings.tokenSavers?.compressToolDescriptions) {
        const countFor = initialActiveTools ? new Set(initialActiveTools) : undefined
        const saved = compactToolDescriptionsInPlace(tools, countFor)
        if (saved > 0 && retryCount === 0 && apiRetryCount === 0) {
          recordSavings("toolDesc", saved)
        }
      }
      const sddDraft = Object.values(useSddStore.getState().drafts).find(
        (d) => d.assistantSessionId === sid,
      )
      // Local in-process models get a LEAN system prompt. The full agent
      // preamble (tools, skills, agent names) overwhelms small local models and
      // makes them ramble — e.g. answering "which model are you?" with the skill
      const localCodeHint =
        localCodeIntel.length > 0
          ? " A code index IS available: prefer `code_search`/`code_query` (and `code_callers`/`code_callees`/`code_trace`) to locate symbols and understand the codebase BEFORE reading whole files — it is far cheaper than reading many files. For a LARGE file, call `read_summary` first to see its outline (symbols + line numbers), then `read_file` with offset/limit on the part you need — reading the whole file can overflow the context window."
          : ""
      const recentText = lastUserText(history)
      const localMemory =
        localRuntimeProvider
          ? await buildMemoryPromptSections({
              workspacePath: cur.workspacePath,
              memory: eff.memory,
              recentText,
              mode: "lean",
            })
          : []
      const localMemoryText = localMemory.length ? "\n" + localMemory.join("\n") : ""
      const localSkillsCatalog =
        localRuntimeProvider && localAgent
          ? await buildSkillsPromptSection(cur.workspacePath, {
              recentText,
              disabledSkills: settings.disabledSkills,
            })
          : ""
      const localSkillsText = localSkillsCatalog ? "\n" + localSkillsCatalog : ""
      const systemBase =
        localRuntimeProvider
          ? localAgent
            ? "You are a coding assistant running locally inside Codezal. You have a lean set of core tools plus a `tool_search` tool to discover more. EMIT tool calls yourself (do not describe them or ask the user to run them) to read/edit files and run commands, then answer." +
              localCodeHint +
              " For plain questions, just answer directly. Reply in the user's language." +
              localMemoryText +
              localSkillsText
            : "You are a helpful, concise assistant running locally inside Codezal. Reply directly, in the user's language." +
              localMemoryText
          : await buildSystemPrompt({
              activeGoal: cur.goal,
              workspacePath: cur.workspacePath,
              modelLabel: `${provider}/${modelId}`,
              mode: cur.mode ?? "build",
              sddStage: sddDraft?.stage,
              sddRequirementPath: sddDraft
                ? sddRequirementPath(sddDraft.workspacePath, sddDraft.id)
                : undefined,
              orchestra: cur.orchestra,
              tokenSavers: settings.tokenSavers,
              memory: eff.memory,
              deferredTools: deferred,
              mcpInstructions: listConnectedMcpInstructions(),
              peers: listPeers(useSessionsStore.getState().index, sid),
              ownHandle: cur.handle,
              recentText,
              delegationMode: cur.delegationMode ?? "solo",
            })
      // While background jobs started by this session are still running, ground
      // the model with their live status — otherwise a fresh user message
      // ("bitti mi?") gets answered from the stale transcript and the model
      // resurrects the previous topic (the "alzheimer" loop).
      const bgNote = buildBackgroundJobsNote(
        useJobsStore.getState().list().filter((j) => j.ownerSessionId === sid),
        { freshUserTurn: history[history.length - 1]?.role === "user" },
      )
      const system = bgNote ? systemBase + "\n\n" + bgNote : systemBase
      // Model capabilities (reasoning support, output limit) from the catalog.
      const catalogData = settings.providerCatalog?.data as ProvidersCatalog | undefined
      const detail = modelDetail(catalogData, provider, modelId)
      const reasoningCapable = detail?.reasoning ?? false
      const outputLimit = detail?.limit?.output
      const effort: ReasoningEffort = resolveReasoningEffort({
        providerId: provider,
        modelId,
        reasoningCapable,
        sessionEffort: cur.reasoningEffort,
        byModel: settings.reasoningEffortByModel,
      })
      const reasoningActive = reasoningCapable && effort !== "off"

      let outgoingHistory = deps.sanitizeHistoryForProvider(history)
      const hh = settings.tokenSavers?.historyHygiene
      if (hh?.enabled) {
        const r = applyHistoryHygiene(outgoingHistory, {
          maxLines: hh.maxLines,
          maxBytes: hh.maxBytes,
        })
        outgoingHistory = r.messages
        if (r.saved > 0 && retryCount === 0 && apiRetryCount === 0) {
          recordSavings("historyHygiene", r.saved)
        }
      }
      // System prompt is injected into the message list (stable cache breakpoint),
      // then the whole history is surrogate/toolCallId-normalized + cache-stamped
      // for this provider (prompt caching → big cost/latency win on Anthropic).
      const messages = transformHistory(
        [{ role: "system", content: system } as ModelMessage, ...outgoingHistory],
        provider,
        modelId,
        modelAcceptsImages(catalogData, provider, modelId),
      )
      // Privacy Filter — cloud provider + enabled ise giden mesajlardaki PII'yi
      let outboundMessages = messages
      const privacyCfg = settings.privacy
      if (privacyActive(privacyCfg, provider)) {
        const scrubber = new PrivacyScrubber(privacyCfg!)
        outboundMessages = scrubber.scrubMessages(messages)
        const leaks = scrubber.verify(outboundMessages)
        if (leaks.length > 0) {
          throw new Error(
            `Privacy Filter: scrub sonrası ${leaks.length} PII kalıntısı saptandı (fail-closed) — ` +
              `buluta gönderim engellendi. Settings → Privacy'den deseni gözden geçirin.`,
          )
        }
        unscrub = (s) => scrubber.unscrub(s)
        if (scrubber.count > 0) console.info(`[privacy] ${scrubber.count} varlık scrub'landı → ${provider}`)
      }
      // providerOptions: reasoning thinking/effort + prompt-cache routing key.
      const providerOptions = buildProviderOptions({
        providerId: provider,
        modelId,
        sessionId: sid,
        effort,
        reasoningCapable,
        outputLimit,
      })

      const stallController = new AbortController()
      if (ac.signal.aborted) stallController.abort()
      else ac.signal.addEventListener("abort", () => stallController.abort(), { once: true })

      const guardReserve = outputLimit && outputLimit > 0 ? outputLimit : 20_000
      const guardTrigger = Math.floor(Math.max(0, effCtxWindow - guardReserve) * 0.7)

      const preCtxTokens = estimateMessagesTokens(outboundMessages)
      useSessionsStore
        .getState()
        .setEffectiveContextTokensFor(
          sid,
          preCtxTokens,
          buildContextBreakdown(system, tools, preCtxTokens),
        )

      // Ground-truth context accounting: ask the SDK to record the exact
      // messages sent on every step, then derive the popover breakdown from the
      // provider-reported inputTokens instead of our pre-send estimate.
      let lastStepEff: number | undefined
      let lastStepBreakdown: ContextBreakdown | undefined
      let lastStepInput: number | undefined
      let toolsJson = ""
      try {
        toolsJson = JSON.stringify(tools ?? {})
      } catch {
        toolsJson = ""
      }

      const result = streamText({
        model,
        allowSystemInMessages: true,
        messages: outboundMessages,
        include: { requestMessages: true },
        onStepEnd: (step) => {
          const reqMsgs = step.request.messages
          if (!reqMsgs || reqMsgs.length === 0) return
          const realInput = step.usage.inputTokens
          const { eff, breakdown } = breakdownFromStepRequest(reqMsgs, realInput, toolsJson)
          lastStepEff = eff
          lastStepBreakdown = breakdown
          lastStepInput = realInput
          useSessionsStore.getState().setEffectiveContextTokensFor(sid, eff, breakdown)
        },
        // Local models can't reliably drive the multi-step agent loop (a 7B
        // spins on junk/empty tool steps), so run them as plain single-turn
        // chat — no tools, one step. Re-enable when a capable local model lands.
        tools: localRuntimeProvider && !localAgent ? {} : tools,
        ...(initialActiveTools
          ? { activeTools: initialActiveTools as (keyof typeof tools)[] }
          : {}),
        // olarak enjekte et — tool-result image openai-uyumlu provider'larda (Kimi)
        prepareStep: ({ steps, messages: stepMessages }) => {
          const out: {
            activeTools?: (keyof typeof tools)[]
            messages?: ModelMessage[]
          } = {}
          if (initialActiveTools) out.activeTools = [...activeSet] as (keyof typeof tools)[]

          let base = stepMessages
          if (estimateMessagesTokens(stepMessages) >= guardTrigger) {
            const { messages: pruned, prunedTokens } = pruneToolOutputs(stepMessages, {
              tailTurns: 0,
              protectTokens: protectBudget,
              minGain: 1,
            })
            if (prunedTokens > 0) {
              base = pruned
              out.messages = pruned
              console.info(
                `[stream-guard] intra-turn prune ~${prunedTokens} tok (eşik ${guardTrigger})`,
              )
            }
          }

          const last = steps[steps.length - 1]
          if (last) {
            const imgs: ModelMessage[] = []
            for (const tr of last.toolResults) {
              if (tr.toolName === "browser_screenshot") {
                const b64 = pendingScreenshots.get(tr.toolCallId)
                if (b64) {
                  pendingScreenshots.delete(tr.toolCallId)
                  imgs.push({
                    role: "user",
                    content: [
                      { type: "text", text: "browser_screenshot:" },
                      { type: "image", image: `data:image/jpeg;base64,${b64}` },
                    ],
                  })
                }
              }
            }
            if (imgs.length) out.messages = [...base, ...imgs]
          }
          useSessionsStore
            .getState()
            .setEffectiveContextTokensFor(sid, estimateMessagesTokens(out.messages ?? base))
          return out
        },
        ...(Object.keys(providerOptions).length > 0
          ? { providerOptions: providerOptions as Parameters<typeof streamText>[0]["providerOptions"] }
          : {}),
        // Reasoning models need the full output window for thinking + answer;
        // only cap output (OpenCode-style 32k) when reasoning is off.
        ...(reasoningActive ? {} : { maxOutputTokens: maxOutputTokens(outputLimit) }),
        stopWhen: isStepCount(localRuntimeProvider ? (localAgent ? 12 : 1) : 200),
        abortSignal: stallController.signal,
        experimental_transform: smoothStream({
          delayInMs: 3,
          chunking: (buffer: string) => (buffer.length > 0 ? buffer.slice(0, 1) : undefined),
        }),
        // Tool-call repair: NoSuchToolError (fuzzy match) + InvalidToolInputError (JSON yamalama).
        experimental_repairToolCall: makeToolCallRepair(),
        onError: ({ error }) => {
          console.error("[streamText] error:", error)
        },
      })
      streamResult = result
      protocolTextFilter = shouldStripVisibleToolProtocol(
        provider,
        modelId,
        !(localRuntimeProvider && !localAgent) && Object.keys(tools).length > 0,
      )
        ? createVisibleToolProtocolFilter()
        : null

      // Reasoning models can "think" for minutes before emitting the first
      // token — give them a longer leash so the watchdog doesn't kill a
      // perfectly healthy generation.
      const STALL_TIMEOUT_MS = reasoningActive ? 600_000 : 180_000
      const TOOL_STALL_TIMEOUT_MS = 600_000
      const STALL_CHECK_MS = 5_000
      // After the system wakes from sleep the TCP/SSE connection is almost
      // certainly dead.  Give the stream a short grace period to recover;
      // if no chunk arrives within this window, abort and let the retry loop
      // open a fresh connection.
      const POST_WAKE_STALL_MS = 30_000
      // Background throttling (macOS App Nap / browser-style background tab
      // throttling) coalesces timers to roughly once a minute, so a gap just
      // above the check interval is NOT proof of sleep. Require a gap well
      // beyond typical throttling before declaring a wake event.
      const WAKE_DETECT_MS = 90_000
      let lastChunkAt = Date.now()
      let lastTickAt = Date.now()
      let postWake = false
      let pendingTools = 0
      // toolCallId → toolName for in-flight tools. Lets the watchdog tell a
      // genuinely stuck tool apart from one that is deliberately waiting on
      // the user (question / propose_plan / propose_build), which must never
      // be aborted as a stall no matter how long the user takes to answer.
      const pendingToolNames = new Map<string, string>()
      let toolRunStartedAt = 0
      const suppressedCalls = new Set<string>()
      stallWatchdog = setInterval(() => {
        const now = Date.now()
        const tickGap = now - lastTickAt
        lastTickAt = now

        // Sleep / wake detection: a gap far beyond normal background timer
        // throttling means the JS event loop was suspended (system sleep /
        // hibernate) rather than the app merely being backgrounded.
        if (tickGap > WAKE_DETECT_MS) {
          // Reset the stall timer so we don't abort on stale timestamps, but
          // switch to a short post-wake timeout — the connection is likely
          // dead and we want to retry quickly rather than wait the full
          // stall window.
          lastChunkAt = now
          postWake = true
          toast.info(tStatic("toast.streamWakeReconnect"))
          return
        }

        if (pendingTools > 0) {
          // A tool waiting on the user (question / propose_plan / propose_build)
          // can legitimately idle for as long as the user takes to answer — it
          // is NOT a stall. Never abort the turn while such a tool is pending;
          // when the user answers the stream resumes and finishes normally.
          for (const name of pendingToolNames.values()) {
            if (isUserWaitingTool(name)) return
          }
          // (d) spawn_agent gibi ilerleme sinyali veren tool'lar lastToolBeat'i bumplar;
          const beat = lastToolBeat(sid)
          const ref = beat && beat > toolRunStartedAt ? beat : toolRunStartedAt
          if (now - ref > TOOL_STALL_TIMEOUT_MS) {
            streamStalled = true
            stallController.abort()
          }
          return
        }
        const effectiveTimeout = postWake ? POST_WAKE_STALL_MS : STALL_TIMEOUT_MS
        if (now - lastChunkAt > effectiveTimeout) {
          streamStalled = true
          stallController.abort()
        }
      }, STALL_CHECK_MS)
      let finalFinishReason: string | undefined
      for await (const chunk of result.stream) {
        lastChunkAt = Date.now()
        postWake = false // connection is alive — leave post-wake mode
        switch (chunk.type) {
          case "text-delta":
            if (thinkSplitter) {
              thinkSplitter.feed(chunk.text ?? "")
            } else {
              if (reasoningBuf) {
                flushReasoning()
              }
              appendText(chunk.text ?? "")
            }
            schedulePatch()
            break
          case "reasoning-delta": {
            flushProtocolText()
            if (textBuf) {
              flushText()
            }
            const delta = (chunk as { text?: string }).text ?? ""
            reasoningBuf += delta
            schedulePatch()
            break
          }
          case "tool-call":
            thinkSplitter?.flush()
            flushProtocolText()
            flushText()
            flushReasoning()
            if (pendingTools === 0) toolRunStartedAt = Date.now()
            pendingTools++
            pendingToolNames.set(chunk.toolCallId, chunk.toolName)
            if (looksLikeQuotedSyntax(chunk.toolName)) {
              suppressedCalls.add(chunk.toolCallId)
            } else {
              parts.push({
                type: "tool-call",
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              })
            }
            syncFlush()
            break
          case "tool-result":
            if (pendingTools > 0) pendingTools--
            pendingToolNames.delete(chunk.toolCallId)
            if (suppressedCalls.has(chunk.toolCallId)) {
              syncFlush()
              break
            }
            parts.push({
              type: "tool-result",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              output: stringifyToolOutput(chunk.output),
            })
            syncFlush()
            break
          case "tool-error":
            // Tool execute throw etti veya repair-fail invalid-arg → tool-error chunk.
            if (pendingTools > 0) pendingTools--
            pendingToolNames.delete(chunk.toolCallId)
            if (suppressedCalls.has(chunk.toolCallId) || looksLikeQuotedSyntax(chunk.toolName)) {
              suppressedCalls.add(chunk.toolCallId)
              syncFlush()
              break
            }
            parts.push({
              type: "tool-result",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              output: errorMessage(chunk.error),
              isError: true,
            })
            // Main-flow tool failure (execute throw / repair-fail invalid arg).
            // Unlike worker tool-results we DO have the error text here, so the
            // log captures the real message + stack + tool + session.
            void logError({
              source: `tool-error:${chunk.toolName}`,
              message: errorMessage(chunk.error),
              name: chunk.error instanceof Error ? chunk.error.name : undefined,
              stack: chunk.error instanceof Error ? chunk.error.stack : undefined,
              context: { sessionId: sid, tool: chunk.toolName, toolCallId: chunk.toolCallId },
            })
            syncFlush()
            break
          case "error": {
            cancelRaf()
            const err = chunk.error
            console.error("[stream chunk error]", err)
            throw err instanceof Error ? err : new Error(errorMessage(err))
          }
          case "finish": {
            const reason = (chunk as { finishReason?: string }).finishReason
            finalFinishReason = reason
            if (reason && reason !== "stop" && reason !== "tool-calls") {
              console.warn("[stream finish]", reason)
            }
            break
          }
        }
      }
      if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = undefined }
      cancelRaf()
      thinkSplitter?.flush()
      flushProtocolText()
      flushText()
      flushReasoning()

      // Clean-close truncation: the provider can drop the SSE connection
      // mid-turn without an error event or a terminal finish chunk. The SDK
      // then reports a normal end (finishReason undefined/"unknown"), which
      // would leave the message half-written with no error and no retry.
      // Treat it like a stall and let the catch below schedule a retry.
      if (
        !ac.signal.aborted &&
        !streamStalled &&
        (finalFinishReason === undefined || finalFinishReason === "unknown")
      ) {
        streamTruncated = true
        throw new Error("stream ended without a terminal finish — connection dropped mid-turn")
      }

      // kaybediyordu. Tam history'yi replace ile yaz.
      const resp = await result.response
      const cleanMessages = stripVisibleToolProtocolMessages(
        stripSuppressedToolMessages(resp.messages, suppressedCalls),
      )
      let finalMessages = cleanMessages

      // Empty-final guard: if the run produced no assistant text (it halted on a
      // tool step at the isStepCount cap), force one no-tools summarization so the
      // turn never ends blank. Mirrors the spawn_agent fallback / OpenCode's
      // max-steps reminder. Only runs in the rare empty case.
      if (!collapseText(parts).trim()) {
        try {
          // Prune before summarizing — the combined history may already be near
          // the context limit, and an overflow here would silently fail.
          let summaryInput: ModelMessage[] = [...history, ...cleanMessages]
          const summaryTokens = estimateMessagesTokens(summaryInput)
          if (summaryTokens > guardTrigger) {
            const { messages: pruned } = pruneToolOutputs(summaryInput, {
              tailTurns: 2,
              protectTokens: protectBudget,
              minGain: 1,
            })
            summaryInput = pruned
          }
          const wrap = await generateText({
            model,
            allowSystemInMessages: true,
            messages: [
              ...summaryInput,
              { role: "user", content: "Summarize what you did and the result as your final answer." },
            ],
            abortSignal: ac.signal,
          })
          deps.recordAuxUsage(sid, wrap.usage, provider, modelId)
          const summary = wrap.text.trim()
          if (summary) {
            parts.push({ type: "text", text: summary })
            finalMessages = [...cleanMessages, { role: "assistant", content: summary }]
          }
        } catch {
          // ignore — leave the turn as-is if the summarization call fails
        }
      }

      useSessionsStore.getState().replaceModelMessagesFor(sid, [...history, ...finalMessages])

      finalStopReason = detectStopReason(finalFinishReason, parts[parts.length - 1])

      patchFor(asstMsgId, {
        parts: [...parts],
        content: collapseText(parts),
        pending: false,
        modelMsgCount: finalMessages.length,
        stopReason: finalStopReason,
        endedAt: Date.now(),
      })

      const updatedSnap = useSessionsStore.getState().sessions[sid]
      // Prefer the last step's provider-reported ground truth (set by
      // onStepEnd); fall back to the local estimate only when the SDK gave us
      // no request/usage data (e.g. providers that omit usage).
      const effectiveTokens =
        lastStepEff ??
        (updatedSnap
          ? estimateMessagesTokens(updatedSnap.modelMessages ?? [], system)
          : 0)
      const contextBreakdown =
        lastStepBreakdown ?? buildContextBreakdown(system, tools, effectiveTokens)

      try {
        const usage = await result.usage
        if (usage) {
          const input = usage.inputTokens ?? 0
          const output = usage.outputTokens ?? 0
          const cacheRead =
            usage.inputTokenDetails?.cacheReadTokens ??
            (usage as { cachedInputTokens?: number }).cachedInputTokens ??
            (usage as { promptCacheHitTokens?: number }).promptCacheHitTokens ??
            0
          const reasoning =
            (usage as { reasoningTokens?: number }).reasoningTokens ?? 0
          useSessionsStore.getState().addUsageFor(sid, {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            reasoningTokens: reasoning,
            costUsd: costUsd(
              modelId,
              { input, output, cacheRead },
              catalogPricing(
                settings.providerCatalog?.data as ProvidersCatalog | undefined,
                provider,
                modelId,
              ),
            ),
            lastInputTokens: lastStepInput ?? input,
            effectiveContextTokens: effectiveTokens,
            contextBreakdown,
          })
        } else {
          useSessionsStore.getState().setEffectiveContextTokensFor(sid, effectiveTokens, contextBreakdown)
        }
      } catch {
        useSessionsStore.getState().setEffectiveContextTokensFor(sid, effectiveTokens)
      }

      if (localStatsProvider) {
        const st = useLocalRuntimeStore.getState().lastStats
        if (st) {
          useSessionsStore.getState().patchMessageFor(sid, asstMsgId, {
            localStats: { tokPerSec: st.tokPerSec, tokens: st.tokens, ttftMs: st.ttftMs },
          })
        }
      }

      await useSessionsStore.getState().persistSession(sid)
      streamSucceeded = true
      }
    } catch (e) {
      // The error path skips the awaits on result.response / result.usage /
      // etc. below, so those lazy promises reject with the same stream error
      // and surface as unhandledrejection noise. Consume them silently — the
      // real error is already handled here.
      if (streamResult) {
        for (const p of [
          streamResult.response,
          streamResult.usage,
          streamResult.totalUsage,
          streamResult.finishReason,
          streamResult.text,
          streamResult.content,
          streamResult.steps,
        ] as Promise<unknown>[]) {
          void p.catch(() => {})
        }
      }
      if (isCliAgentProvider(provider)) {
        if (!ac.signal.aborted) deps.setError(errorMessage(e), sid)
      } else {
      cancelRaf()
      thinkSplitter?.flush()
      flushProtocolText()
      flushText()
      flushReasoning()
      const partialText = collapseText(parts)
      const partial: ModelMessage[] = partialText.trim()
        ? [{ role: "assistant", content: partialText }]
        : []
      useSessionsStore.getState().replaceModelMessagesFor(sid, [...history, ...partial])
      patchFor(asstMsgId, {
        parts: [...parts],
        content: partialText,
        pending: false,
        modelMsgCount: partial.length,
        endedAt: Date.now(),
      })
      await useSessionsStore.getState().persistSession(sid).catch(() => {})
      if (streamStalled) {
        if (apiRetryCount < MAX_API_RETRIES) {
          retryDelay = stallRetryDelayMs(apiRetryCount + 1)
          retryMessage = tStatic("toast.streamStalledFailed")
          retryPending = true
        } else {
          deps.setError(tStatic("toast.streamStalledFailed"), sid)
        }
      } else if (streamTruncated) {
        if (apiRetryCount < MAX_API_RETRIES) {
          retryDelay = stallRetryDelayMs(apiRetryCount + 1)
          retryMessage = tStatic("toast.streamTruncatedFailed")
          retryPending = true
        } else {
          deps.setError(tStatic("toast.streamTruncatedFailed"), sid)
        }
      } else if (!ac.signal.aborted) {
        const parsed = parseStreamError(e)
        if (parsed?.type === "context_overflow" && retryCount < 1) {
          // Compact + retry deferred to after finally (single-flight guard
          // rejects a new run while streamingIds[sid] is still true).
          overflowDetected = true
        } else if (isRetryableError(parsed) && apiRetryCount < MAX_API_RETRIES) {
          retryDelay = retryDelayMs(
            apiRetryCount + 1,
            parsed?.type === "api_error" ? parsed.retryAfterMs : undefined,
          )
          retryMessage = parsed?.message ?? errorMessage(e)
          retryPending = true
        } else if (
          isContentFilterError(parsed) &&
          useSessionsStore.getState().activeId === sid
        ) {
          const msgs = useSessionsStore.getState().sessions[sid]?.messages ?? []
          const lastUser = [...msgs].reverse().find((m) => m.role === "user" && !m.meta)
          if (lastUser?.content) insertToFocusedComposer(lastUser.content)
          deps.setError(tStatic("errorBanner.contentFiltered"), sid)
        } else {
          const base = parsed?.message ?? errorMessage(e)
          const ra = parsed?.type === "api_error" ? parsed.retryAfterMs : undefined
          deps.setError(
            ra
              ? `${base} · ${tStatic("errorBanner.retryAfter", {
                  time: new Date(Date.now() + ra).toLocaleTimeString(),
                })}`
              : base,
            sid,
          )
        }
      }
      }
    } finally {
      if (stallWatchdog) clearInterval(stallWatchdog)
      useSessionsStore.getState().setStreamingFor(sid, false)
      useQuestionsStore.getState().cancelBySession(sid)
      const aborted = ac.signal.aborted
      clearStreamAbort(sid, ac)
      if (!aborted && sid !== useSessionsStore.getState().activeId) {
        const title = useSessionsStore.getState().sessions[sid]?.title ?? "Sohbet"
        if (streamSucceeded && !finalStopReason) {
          toast.success(`"${title}" tamamlandı`)
        } else if (streamSucceeded && finalStopReason) {
          // The turn ended prematurely (step-cap / truncation) — never report
          // that as "completed". The foreground banner offers Continue; here we
          // just avoid the misleading success toast.
          toast.info(`"${title}" yarım kaldı`)
        } else if (streamStalled || streamTruncated) {
          toast.error(tStatic("toast.streamFailedBg", { title }))
        }
      }
    }

    const fireTurnEnd = (reason: string) => {
      const st = useSessionsStore.getState()
      const ws = st.sessions[sid]?.workspacePath ?? cur.workspacePath
      void runHooks({
        hooks: getEffectiveSettings(ws).hooks,
        event: st.activeId === sid ? "Stop" : "SubagentStop",
        payload: { reason },
        workspace: ws,
      }).catch((e) => console.warn("[hook] Stop error:", e))
    }

    // ---- Context-overflow reaktif kurtarma ----
    if (overflowDetected && !ac.signal.aborted) {
      useSessionsStore.getState().setStreamingFor(sid, true)
      const provForCompact = override?.provider ?? cur.provider
      const modelForCompact = override?.model ?? cur.model
      const before = useSessionsStore.getState().sessions[sid]?.modelMessages ?? history
      let compactedOk = false
      let working = before
      const { messages: hardPruned, prunedTokens } = pruneToolOutputs(before, {
        tailTurns: 0,
        protectTokens: protectBudget,
        minGain: 1,
      })
      if (prunedTokens > 0) {
        working = hardPruned
        compactedOk = true
      }
      try {
        const { messages: compacted, usage, usedProvider, usedModel } = await compactMessages({
          messages: working,
          appSettings: settings,
          activeProvider: provForCompact,
          activeModel: modelForCompact,
          settings: settings.autoCompact,
        })
        if (usedProvider && usedModel) deps.recordAuxUsage(sid, usage, usedProvider, usedModel)
        if (compacted.length < working.length) {
          working = compacted
          compactedOk = true
        }
      } catch (e) {
        console.error("[overflow] compact failed:", e)
      }
      // Last resort: strip image parts to reclaim tokens.
      // Images are the largest per-message payload; replacing them with a text
      // marker often frees enough space for the retry to succeed.
      if (!compactedOk) {
        const stripped = stripImageParts(working)
        if (stripped !== working) {
          working = stripped
          compactedOk = true
          console.info("[overflow] image parts stripped as last-resort recovery")
        }
      }
      if (compactedOk) {
        useSessionsStore.getState().replaceModelMessagesFor(sid, working)
        const retryHistory = useSessionsStore.getState().sessions[sid]?.modelMessages ?? history
        // Reuse the same (now-empty) assistant bubble for the retry — avoids an
        // orphan blank message. Reset it to pending and re-stream into it.
        useSessionsStore.getState().patchMessageFor(sid, asstMsgId, {
          parts: [],
          content: "",
          pending: true,
          modelMsgCount: 0,
        })
        deps.setError(null, sid)
        useSessionsStore.getState().setStreamingFor(sid, false)
        await runStream(sid, asstMsgId, retryHistory, override, retryCount + 1)
      } else {
        useSessionsStore.getState().setStreamingFor(sid, false)
        const effCtx =
          localRuntimeProvider ? useLocalRuntimeStore.getState().effectiveCtx[modelId] : undefined
        const settingCtx = resolveLocalLlm(settings, modelId).contextWindow
        deps.setError(
          effCtx && effCtx < settingCtx
            ? tStatic("app.localCtxTooSmall", { effective: String(effCtx) })
            : tStatic("app.contextOverflow"),
          sid,
        )
        fireTurnEnd("finish")
      }
      return
    }

    if (retryPending && !ac.signal.aborted) {
      useSessionsStore.getState().setStreamingFor(sid, true)
      toast.info(tStatic("toast.streamRetry", { attempt: String(apiRetryCount + 1), max: String(MAX_API_RETRIES) }))
      const completed = await new Promise<boolean>((resolve) => {
        if (ac.signal.aborted) return resolve(false)
        const onAbort = () => {
          clearTimeout(timer)
          resolve(false)
        }
        const timer = setTimeout(() => {
          ac.signal.removeEventListener("abort", onAbort)
          resolve(true)
        }, retryDelay)
        ac.signal.addEventListener("abort", onAbort, { once: true })
      })
      if (!completed || ac.signal.aborted) {
        useSessionsStore.getState().setStreamingFor(sid, false)
        deps.setError(retryMessage, sid)
        fireTurnEnd("abort")
        return
      }
      const retryHistory = history
      useSessionsStore.getState().patchMessageFor(sid, asstMsgId, {
        parts: [],
        content: "",
        pending: true,
        modelMsgCount: 0,
      })
      deps.setError(null, sid)
      useSessionsStore.getState().setStreamingFor(sid, false)
      await runStream(sid, asstMsgId, retryHistory, override, retryCount, apiRetryCount + 1)
      return
    }

    // ---- Auto title ----

    if (!ac.signal.aborted && streamSucceeded && hasInbox(sid)) {
      const inboxMsg = takeInbox(sid)
      const inboxSess = inboxMsg ? useSessionsStore.getState().sessions[sid] : undefined
      if (inboxMsg && inboxSess) {
        const content = framePeerMessage(inboxMsg.fromLabel, inboxMsg.text)
        const inUser: Message = {
          id: createId("message"),
          role: "user",
          content,
          modelMsgCount: 1,
        }
        const inAsst: Message = {
          id: createId("message"),
          role: "assistant",
          content: "",
          parts: [],
          pending: true,
        }
        useSessionsStore.getState().pushMessageFor(sid, inUser)
        useSessionsStore.getState().pushMessageFor(sid, inAsst)
        const inHistory: ModelMessage[] = [
          ...(inboxSess.modelMessages ?? []),
          { role: "user", content },
        ]
        await runStream(sid, inAsst.id, inHistory)
        return
      }
    }

    // ---- Goal sentinel-loop ----
    const goal = useSessionsStore.getState().sessions[sid]?.goal
    if (!goal) {
      if (ac.signal.aborted) {
        fireTurnEnd("abort")
        return
      }
      // ---- Auto-continue on premature stop ----
      // A turn that ended on `halted` (step budget exhausted mid tool-loop, or
      // an early truncation on a tool) is almost always a half-finished task.
      // Keep going automatically — the same way the goal loop does — up to a
      // small budget, so long multi-tool jobs don't silently stall mid-way.
      // Once the budget is spent the turn simply ends and the
      // "incomplete / Continue" banner (driven by stopReason) lets the user
      // resume by hand. `length` is left to the banner on purpose: resuming a
      // turn that was cut mid tool-call JSON is unsafe.
      const AUTO_CONTINUE_MAX = 3
      if (
        streamSucceeded &&
        finalStopReason === "halted" &&
        autoContinueCount < AUTO_CONTINUE_MAX
      ) {
        const sess = useSessionsStore.getState().sessions[sid]
        if (sess) {
          const contText =
            "The previous turn was cut off before the task was finished (step limit reached). Continue exactly where you left off and keep working until the task is fully complete — do not stop after a single step."
          const contUser: Message = {
            id: createId("message"),
            role: "user",
            content: contText,
            modelMsgCount: 1,
          }
          const contAsst: Message = {
            id: createId("message"),
            role: "assistant",
            content: "",
            parts: [],
            pending: true,
          }
          useSessionsStore.getState().pushMessageFor(sid, contUser)
          useSessionsStore.getState().pushMessageFor(sid, contAsst)
          const contHistory: ModelMessage[] = [
            ...(sess.modelMessages ?? []),
            { role: "user", content: contText },
          ]
          await runStream(
            sid,
            contAsst.id,
            contHistory,
            override,
            0,
            0,
            autoContinueCount + 1,
          )
          return
        }
      }
      // ---- Hallucinated-completion guard ----
      // The turn ended "cleanly" (stopReason undefined) with a confident
      // "all done" report, yet no file-modifying tool ran — the model claimed
      // work it never did. Send it back once to actually apply the changes,
      // with a visible note so the user understands the extra turn.
      if (streamSucceeded && !finalStopReason && !completionNudged) {
        const sess = useSessionsStore.getState().sessions[sid]
        const recentUserTexts = (sess?.messages ?? [])
          .filter((m) => m.role === "user" && !m.meta)
          .slice(-2)
          .map((m) => m.content)
        const finalText = collapseText(parts)
        if (
          sess &&
          needsCompletionNudge({ parts, finalText, recentUserTexts })
        ) {
          useSessionsStore.getState().pushMessageFor(sid, {
            id: createId("message"),
            role: "system",
            content: tStatic("app.completionNudgeNote"),
          })
          const contUser: Message = {
            id: createId("message"),
            role: "user",
            content: COMPLETION_NUDGE_TEXT,
            modelMsgCount: 1,
          }
          const contAsst: Message = {
            id: createId("message"),
            role: "assistant",
            content: "",
            parts: [],
            pending: true,
          }
          useSessionsStore.getState().pushMessageFor(sid, contUser)
          useSessionsStore.getState().pushMessageFor(sid, contAsst)
          const contHistory: ModelMessage[] = [
            ...(sess.modelMessages ?? []),
            { role: "user", content: COMPLETION_NUDGE_TEXT },
          ]
          await runStream(
            sid,
            contAsst.id,
            contHistory,
            override,
            0,
            0,
            autoContinueCount,
            true,
          )
          return
        }
      }
      if (streamSucceeded) fireTurnEnd("end_turn")
      else fireTurnEnd("finish")
      return
    }

    const pushGoalSystem = (msg: string) => {
      useSessionsStore.getState().pushMessageFor(sid, {
        id: createId("message"),
        role: "system",
        content: msg,
      })
    }
    const clearGoalSid = () => useSessionsStore.getState().clearGoalFor(sid)

    if (ac.signal.aborted) {
      clearGoalSid()
      pushGoalSystem(`⏹ Goal durduruldu (kullanıcı iptal etti): "${goal.text}"`)
      fireTurnEnd("abort")
      return
    }
    if (!streamSucceeded) {
      // Transient errors (rate-limit, network, 5xx, timeout) → pause the goal
      // so the user can resume later instead of losing progress.
      const transient =
        /rate.?limit|429|too many requests|network|timeout|timed?.?out|ECONNRESET|ECONNREFUSED|socket hang up|5\d{2}\s|overloaded|capacity|temporarily unavailable/i.test(
          retryMessage,
        ) || streamStalled || streamTruncated
      if (transient) {
        useSessionsStore.getState().pauseGoalFor(sid)
        pushGoalSystem(
          `⏸ Goal geçici hata nedeniyle duraklatıldı: "${goal.text}" — devam etmek için /goal resume`,
        )
        fireTurnEnd("goal_paused_error")
      } else {
        clearGoalSid()
        pushGoalSystem(`⛔ Goal hata sonrası durduruldu: "${goal.text}"`)
        fireTurnEnd("finish")
      }
      return
    }

    const lastMsg = useSessionsStore
      .getState()
      .sessions[sid]?.messages.find((m) => m.id === asstMsgId)
    const finalText = lastMsg?.content ?? ""

    if (/^[ \t]*\[GOAL_DONE\][ \t]*$/m.test(finalText)) {
      clearGoalSid()
      pushGoalSystem(`✓ Goal tamamlandı: "${goal.text}" (${goal.iter + 1} iterasyon)`)
      fireTurnEnd("goal_done")
      return
    }
    if (/^[ \t]*\[GOAL_BLOCKED\]/m.test(finalText)) {
      clearGoalSid()
      pushGoalSystem(
        `⏸ Goal bloklandı — kullanıcı girdisi bekleniyor: "${goal.text}"`,
      )
      fireTurnEnd("goal_blocked")
      return
    }

    // Budget caps: stop the goal when cumulative token
    // usage or cost exceeds the user-configured limits.
    const goalUsage = useSessionsStore.getState().sessions[sid]?.usage
    if (goalUsage) {
      const totalTokens = (goalUsage.inputTokens ?? 0) + (goalUsage.outputTokens ?? 0)
      if (goal.tokenBudget && goal.tokenBudget > 0 && totalTokens >= goal.tokenBudget) {
        clearGoalSid()
        pushGoalSystem(
          `⛔ Goal token bütçesine (${goal.tokenBudget.toLocaleString()}) ulaştı — durduruldu. Hedef: "${goal.text}"`,
        )
        fireTurnEnd("goal_budget_tokens")
        return
      }
      if (goal.costBudgetUsd && goal.costBudgetUsd > 0 && (goalUsage.costUsd ?? 0) >= goal.costBudgetUsd) {
        clearGoalSid()
        pushGoalSystem(
          `⛔ Goal maliyet bütçesine ($${goal.costBudgetUsd.toFixed(2)}) ulaştı — durduruldu. Hedef: "${goal.text}"`,
        )
        fireTurnEnd("goal_budget_cost")
        return
      }
    }

    if (goal.paused) {
      fireTurnEnd("end_turn")
      return
    }

    if (goal.iter + 1 >= goal.maxIter) {
      clearGoalSid()
      pushGoalSystem(
        `⛔ Goal max iterasyona (${goal.maxIter}) ulaştı — durduruldu. Hedef: "${goal.text}"`,
      )
      fireTurnEnd("goal_max_iter")
      return
    }

    useSessionsStore.getState().incGoalIterFor(sid)
    const sess = useSessionsStore.getState().sessions[sid]
    if (!sess) return
    const contUser: Message = {
      id: createId("message"),
      role: "user",
      content: "Continue.",
      modelMsgCount: 1,
    }
    const contAsst: Message = {
      id: createId("message"),
      role: "assistant",
      content: "",
      parts: [],
      pending: true,
    }
    useSessionsStore.getState().pushMessageFor(sid, contUser)
    useSessionsStore.getState().pushMessageFor(sid, contAsst)
    const contHistory: ModelMessage[] = [
      ...(sess.modelMessages ?? []),
      { role: "user", content: "Continue." },
    ]
    await runStream(sid, contAsst.id, contHistory)
  }

  return runStream
}

// Snapshot what currently fills the context window so the composer popover can
// render a real per-category bar (system prompt / tool definitions /
// conversation). `promptPlusConv` is `estimateMessagesTokens(...)` which already
// folds the system prompt in, so the conversation slice is the remainder. Tools
// are sent alongside the prompt but live outside the message list, so they are
// measured separately from their JSON schema (execute fns are dropped by
// stringify, which matches what the provider actually receives).
function buildContextBreakdown(
  system: string,
  tools: unknown,
  promptPlusConv: number,
): ContextBreakdown {
  const systemTokens = estimateTextTokens(system)
  let toolsTokens = 0
  try {
    toolsTokens = estimateTextTokens(JSON.stringify(tools ?? {}))
  } catch {
    // Non-serializable tool bag — leave the slice at 0 rather than crash.
  }
  return {
    system: systemTokens,
    tools: toolsTokens,
    conversation: Math.max(0, promptPlusConv - systemTokens),
  }
}

// Per-step ground truth (AI SDK v7 `include.requestMessages`): split the
// SDK-recorded request messages into system / conversation slices and take the
// tools slice as the remainder of the provider-reported inputTokens — that
// total also covers tool schemas and provider overhead, so the remainder is
// the most honest "tool definitions" number we can show. Falls back to the
// schema-JSON estimate when the provider reports no usage.
function breakdownFromStepRequest(
  reqMsgs: readonly ModelMessage[],
  realInput: number | undefined,
  toolsJson: string,
): { eff: number; breakdown: ContextBreakdown } {
  let system = 0
  let conversation = 0
  for (const m of reqMsgs) {
    const t = estimateMessagesTokens([m])
    if (m.role === "system") system += t
    else conversation += t
  }
  const tools =
    realInput != null
      ? Math.max(0, realInput - system - conversation)
      : estimateTextTokens(toolsJson)
  const eff = realInput ?? system + conversation + tools
  return { eff, breakdown: { system, tools, conversation } }
}
