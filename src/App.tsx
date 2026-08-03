import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { streamText, generateText, smoothStream, type ModelMessage } from "ai"
import { Sidebar } from "@/components/Sidebar"
import { Toaster } from "@/components/Toaster"
import { TabBar } from "@/components/TabBar"
import { MessageList } from "@/components/MessageList"
import { MascotOverlay } from "@/components/Mascot"
import { Composer, type SendOverride } from "@/components/Composer"
import { SideChatPanel } from "@/components/SideChatPanel"
import { SIDE_CHAT_SYSTEM, buildSideChatMessages, newSideChatThread } from "@/lib/side-chat"
import { ContextPanel } from "@/components/ContextPanel"
import { AgentTranscriptPane } from "@/components/AgentTranscript"
// FileViewer (Monaco Editor) — lazy: defer loading until the editor panel opens
const FileViewer = lazy(() =>
  import("@/components/FileViewer").then((m) => ({ default: m.FileViewer })),
)
import { DiffViewer } from "@/components/DiffViewer"
import { TurnDiffViewer } from "@/components/TurnDiffViewer"
import { OutputViewer } from "@/components/OutputViewer"
import { PRConversationViewer } from "@/components/PRConversationViewer"
import { isDiffUri } from "@/lib/diff-uri"
import { isTurnDiffUri, makeTurnDiffUri } from "@/lib/turn-diff-uri"
import { isOutputUri } from "@/lib/output-doc"
import { isPrUri } from "@/lib/pr-uri"
import { isTerminalUri, makeTerminalUri, parseTerminalUri } from "@/lib/terminal-uri"
import type { PanelMode } from "@/lib/panel-modes"
import { requestOpenPrView } from "@/lib/git-events"
import { renderTemplate } from "@/lib/commands"
import { REVIEW_TEMPLATE } from "@/lib/commands/templates"
import type { SettingsTab } from "@/components/SettingsDrawer"

const SettingsPage = lazy(() =>
  import("@/components/SettingsDrawer").then((m) => ({ default: m.SettingsPage })),
)
// Onboarding — lazy: only ever shown once on first launch.
const Onboarding = lazy(() =>
  import("@/components/Onboarding").then((m) => ({ default: m.Onboarding })),
)
import { ErrorBanner } from "@/components/ErrorBanner"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import type { Page as PalettePage } from "@/components/CommandPalette"
// CommandPalette / SearchOverlay — lazy: opened on demand.
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
)
const SearchOverlay = lazy(() =>
  import("@/components/SearchOverlay").then((m) => ({ default: m.SearchOverlay })),
)
import { ApprovalModal } from "@/components/ApprovalModal"
import { QuestionModal } from "@/components/QuestionModal"
// Routines / Fork / Agent panes — lazy: conditionally mounted overlays.
const AutopilotPage = lazy(() =>
  import("@/components/RoutinesOverlay").then((m) => ({ default: m.AutopilotPage })),
)
const ForkDialog = lazy(() =>
  import("@/components/ForkDialog").then((m) => ({ default: m.ForkDialog })),
)
import { Select } from "@/components/Select"
const HelpOverlay = lazy(() =>
  import("@/components/HelpOverlay").then((m) => ({ default: m.HelpOverlay })),
)
import { Columns2, X } from "@/lib/icons"
import { useNavHistory } from "@/lib/hooks/useNavHistory"
import { useNewSession } from "@/lib/hooks/useNewSession"
import { usePanelState } from "@/lib/hooks/usePanelState"
import { useTerminalsStore } from "@/store/terminals"
import { useTodoPanelAuto } from "@/lib/hooks/useTodoPanelAuto"
import { useAiPanelAuto } from "@/lib/hooks/useAiPanelAuto"
import { useSuggestionsAuto, triggerSuggestionsFor } from "@/lib/hooks/useSuggestionsAuto"
import { useSuggestionsStore } from "@/store/suggestions"
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts"
import { useBootStores } from "@/lib/hooks/useBootStores"
import { useBootDraft } from "@/lib/hooks/useBootDraft"
import type { ProviderId } from "@/lib/providers"
import {
  buildLanguageModel,
  defaultModelFor,
  isConnectedSync,
  listProviderAdapters,
  probeEnvVars,
  transformHistory,
  buildProviderOptions,
  resolveReasoningEffort,
  maxOutputTokens,
  isAuthErrorMessage,
} from "@/lib/providers"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { modelDetail, modelAcceptsPdf, modelAcceptsImages, resolveContextCap, catalogPricing } from "@/lib/providers-catalog"
import { loadPdfBytes, loadPdfDataUrl } from "@/lib/pdf-store"
import { extractPdfText } from "@/lib/pdf"
import { resolveSessionDefaults } from "@/lib/session-defaults"
import { resetAttach } from "@/lib/memory-attach"
import { appendMemory, removeMemoryNote } from "@/lib/memory-write"
import { readProjectMemory, readUserMemory } from "@/lib/memory"
import { DEFAULT_MEMORY } from "@/lib/memory-settings"
import {
  extractMemories,
  usedExternalTools,
  shouldLearn,
  beginLearn,
  endLearn,
} from "@/lib/memory-learn"
import { watchWorkspace } from "@/lib/file-watcher"
import { DEFAULT_TOKEN_SAVERS } from "@/lib/token-savers/types"
import { costUsd } from "@/lib/pricing"
import {
  shouldCompact,
  compactTrigger,
  compactMessages,
  targetTokensAfterCompact,
  pruneToolOutputs,
  RECENT_TOOL_PROTECT_TOKENS,
} from "@/lib/compact"
import { estimateMessagesTokens } from "@/lib/tokens"
import { messagesToModelMessages } from "@/lib/model-history"
import { applyAppearance, watchSystemTheme, applyFontScale, DEFAULT_APPEARANCE } from "@/lib/theme"
import { installTooltipSuppressor } from "@/lib/native-feel"
import { loadUserThemes } from "@/lib/theme-loader"
import type { ThemePreset } from "@/lib/theme-presets"
import { runHooks } from "@/lib/hooks"
import {
  startScheduler,
  stopScheduler,
  refreshScheduler,
} from "@/lib/routine-scheduler"
import type { Routine } from "@/lib/routines"
import { setAutostart, setKeepAwake } from "@/lib/autopilot-bg"
import { subscribeMonitor } from "@/lib/monitor-bus"
import { subscribeSessionMessage } from "@/lib/session-message-bus"
import { enqueueInbox, takeInbox, framePeerMessage } from "@/lib/session-inbox"
import { pickWorkspaceFolder } from "@/lib/workspace"
import { checkForUpdateOnLaunch, UPDATE_CHECK_INTERVAL_MS } from "@/lib/updater"
import { useUpdateStore } from "@/store/update"
import { UpdateToast } from "@/components/UpdateToast"
import type { Update } from "@tauri-apps/plugin-updater"
import { abortStream } from "@/lib/run-registry"
import { makeRunStream } from "@/lib/stream/run-stream"
import { setWorkerStreamFn } from "@/lib/worker-session"
import { decideTurnGate } from "@/lib/stream/turn-gate"
import { inlinesThinkTags } from "@/lib/providers/provider-quirks"
import { createThinkSplitter, type ThinkSplitter } from "@/lib/stream/think-split"
import { toast, useToastStore } from "@/store/toast"
import { useSessionsStore } from "@/store/sessions"
import { useSddStore } from "@/store/sdd"
import { usePreviewStore } from "@/store/preview"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { useJobsStore } from "@/store/jobs"
import { useSettingsStore } from "@/store/settings"
import { resolveEffectiveSettings, getEffectiveSettings } from "@/lib/config"
import { loadImageDataUrl } from "@/lib/image-store"
import type { Message, MessageImage, MessageFile, MessagePdf } from "@/store/types"
import { registerDropTarget } from "@/lib/internal-drag"
import { t as tStatic } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { createId } from "@/lib/id"
import { errorMessage } from "@/lib/errors"
import { createWorktree } from "@/lib/tools/worktree"
import { gitDefaultBranch } from "@/lib/git"
import { getGithubToken, resolveRepo, getIssue } from "@/lib/github"

function buildIssueAgentPrompt(o: {
  number: number
  title: string
  body: string
  base: string
  branch: string
}): string {
  const body = o.body.trim() ? o.body.trim().slice(0, 4000) : "(açıklama yok)"
  return [
    `GitHub issue #${o.number} üzerinde çalış ve bir PR aç.`,
    ``,
    `**Başlık:** ${o.title}`,
    ``,
    `**Açıklama:**`,
    body,
    ``,
    `**Talimatlar:**`,
    `1. Bu izole worktree'de (branch \`${o.branch}\`) issue'yu çözecek değişiklikleri yap.`,
    `2. Çalışmanı net bir mesajla commit'le (Conventional Commits).`,
    `3. Bitince \`create_pr\` tool'unu çağır (gerekirse önce \`tool_search\` ile yükle):`,
    `   - title: issue'yu özetleyen kısa başlık`,
    `   - body: yapılanların özeti + "Closes #${o.number}"`,
    `   - base: ${o.base}`,
    `4. PR açıldıktan sonra PR linkini bildir.`,
    ``,
    `Doğrudan uygula (plan modunda değilsin). Belirsizlikte makul varsayım yap, kapsamı küçük tut.`,
  ].join("\n")
}

function buildTerminalAiPrompt(text: string): string {
  return [
    `Şu terminal çıktısını incele. Hata/başarısızlık varsa nedenini açıkla ve düzelt; ` +
      `yoksa kısaca özetle. Gerekirse ilgili dosyaları oku.`,
    "```",
    text.slice(-8000),
    "```",
  ].join("\n")
}

const compactionInFlight = new Set<string>()

// Sessions whose turn is past the gate but still in pre-stream preparation
// (hooks + auto-compaction). runStream's single-flight flag only flips once the
// stream actually starts, so without this a second send during that window
// would race: UI messages pushed out of order and one turn's text never
// reaching modelMessages.
const preparingTurns = new Set<string>()

const PRECOMPACT_HOOK_TIMEOUT_MS = 5000

const TerminalPanel = lazy(() =>
  import("@/components/TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
)

export default function App() {
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const settings = useSettingsStore((s) => s.settings)

  const workspacePath = useSessionsStore((s) => s.active?.workspacePath)
  const activeFile = useSessionsStore((s) => s.active?.activeFile ?? null)
  const openFile = useSessionsStore((s) => s.openFile)
  const openFilesCount = useSessionsStore((s) => s.active?.openFiles?.length ?? 0)
  const activeSessionId = useSessionsStore((s) => s.activeId)
  const sddAvailable = useSddStore((s) =>
    Object.values(s.drafts).some((d) => d.assistantSessionId === activeSessionId),
  )
  const create = useSessionsStore((s) => s.create)
  const createDraft = useSessionsStore((s) => s.createDraft)
  const pushMessage = useSessionsStore((s) => s.pushMessage)
  const editMessage = useSessionsStore((s) => s.editMessage)
  const truncateAfter = useSessionsStore((s) => s.truncateAfter)
  const forkAt = useSessionsStore((s) => s.forkAt)
  const clearMessages = useSessionsStore((s) => s.clearMessages)
  const revertToBeforeMessage = useSessionsStore((s) => s.revertToBeforeMessage)
  const unrevertSession = useSessionsStore((s) => s.unrevertSession)
  const open = useSessionsStore((s) => s.open)
  const loadIntoPool = useSessionsStore((s) => s.loadIntoPool)
  const setGoal = useSessionsStore((s) => s.setGoal)
  const clearGoal = useSessionsStore((s) => s.clearGoal)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const addProject = useSessionsStore((s) => s.addProject)
  const updateSettings = useSettingsStore((s) => s.update)

  const { panelMode, setPanelMode } = usePanelState(
    workspacePath,
    settingsLoaded,
    settings.openFilesPanelOnLaunch,
  )

  const openNewSession = useNewSession(settings, setPanelMode)

  const toggleTerminalTab = useCallback(() => {
    if (isTerminalUri(activeFile ?? "")) {
      const terminalId = parseTerminalUri(activeFile ?? "")
      if (terminalId) useTerminalsStore.getState().remove(terminalId)
      if (activeFile) useSessionsStore.getState().closeFile(activeFile)
      return
    }
    const chatSession = useSessionsStore.getState().active
    if (!chatSession) return
    const terminalStore = useTerminalsStore.getState()
    const existing = terminalStore.sessions.find(
      (session) =>
        session.chatSessionId === chatSession.id &&
        session.workspacePath === chatSession.workspacePath,
    )
    const terminalId =
      existing?.id ?? terminalStore.create(chatSession.id, chatSession.workspacePath)
    terminalStore.setActive(terminalId)
    setPanelMode(null)
    openFile(makeTerminalUri(terminalId))
  }, [activeFile, openFile, setPanelMode])

  const handlePanelModeChange = useCallback(
    (mode: PanelMode | null) => {
      if (mode === "terminal") {
        toggleTerminalTab()
        return
      }
      setPanelMode(mode)
    },
    [setPanelMode, toggleTerminalTab],
  )

  const { navCan, navBack, navForward } = useNavHistory(activeFile, activeSessionId)

  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined)
  const [showPalette, setShowPalette] = useState(false)
  const [palettePage, setPalettePage] = useState<PalettePage>("root")
  const [showSearch, setShowSearch] = useState(false)
  const [showChatSearch, setShowChatSearch] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [showForkDialog, setShowForkDialog] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [chatScrolled, setChatScrolled] = useState(false)
  const [userThemes, setUserThemes] = useState<ThemePreset[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [sideChatOpen, setSideChatOpen] = useState(false)
  const [sideChatThreadId, setSideChatThreadId] = useState<string | null>(null)
  const [sideChatBusy, setSideChatBusy] = useState(false)
  const sideChatAbortRef = useRef<AbortController | null>(null)
  // Reset per-session transient UI when switching chats. Done during render
  // (React's recommended "adjusting state" pattern) instead of an effect to
  // avoid cascading renders; the abort cleanup still lives in an effect.
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId)
  if (activeSessionId !== prevSessionId) {
    setPrevSessionId(activeSessionId)
    setSideChatThreadId(null)
    setShowRoutines(false)
  }
  useEffect(() => {
    return () => {
      sideChatAbortRef.current?.abort()
      sideChatAbortRef.current = null
    }
  }, [activeSessionId])
  const [splitId, setSplitId] = useState<string | null>(null)
  const splitIdRef = useRef<string | null>(null)
  useEffect(() => {
    splitIdRef.current = splitId
  })
  const changeSplit = useCallback((next: string | null) => {
    const prev = splitIdRef.current
    if (prev && prev !== next) useSessionsStore.getState().dropDetached(prev)
    setSplitId(next)
  }, [])
  const [sessionDragActive, setSessionDragActive] = useState(false)
  const openZoneRef = useRef<HTMLDivElement>(null)
  const splitPaneRef = useRef<HTMLDivElement>(null)
  const dropSessionRef = useRef<(id: string) => void>(() => {})
  // The right-hand agent transcript pane is per-session: each chat remembers
  // its own open worker (if any). Switching chats must never leak another
  // chat's agent into the pane, nor show "agent not found" for a worker that
  // belongs to a different chat.
  const [agentPaneBySession, setAgentPaneBySession] = useState<Record<string, string | null>>({})
  const agentPaneId = activeSessionId ? (agentPaneBySession[activeSessionId] ?? null) : null
  const setAgentPane = useCallback((sessionId: string | null, workerId: string | null) => {
    if (!sessionId) return
    setAgentPaneBySession((prev) =>
      (prev[sessionId] ?? null) === workerId ? prev : { ...prev, [sessionId]: workerId },
    )
  }, [])
  const activeStreaming = useSessionsStore((s) =>
    s.activeId ? !!s.streamingIds[s.activeId] : false,
  )
  const anyStreaming = useSessionsStore((s) => Object.values(s.streamingIds).some(Boolean))
  const activeCompacting = useSessionsStore((s) =>
    s.activeId ? !!s.compactingIds[s.activeId] : false,
  )
  // Worker sessions (parallel agents) are read-only — the user cannot type
  // into them; results flow back to the parent session automatically.
  const activeIsWorker = useSessionsStore((s) =>
    s.activeId ? !!s.sessions[s.activeId]?.ownerSessionId : false,
  )
  const activeWorkerOwnerId = useSessionsStore((s) =>
    s.activeId ? s.sessions[s.activeId]?.ownerSessionId : undefined,
  )
  useTodoPanelAuto(panelMode, setPanelMode, activeStreaming)
  // AI-transient panes (agents / todo / preview): the AI opens them while it
  // works and they close again when the run finishes — they never linger.
  const markAiOpened = useAiPanelAuto(panelMode, setPanelMode, activeStreaming)
  useEffect(() => {
    if (sddAvailable) {
      setPanelMode((m) => (m == null ? "sdd" : m))
    } else {
      setPanelMode((m) => (m === "sdd" ? null : m))
    }
  }, [activeSessionId, sddAvailable, setPanelMode])
  const onOpenSddPreview = useCallback(
    (absPath: string) => {
      const ws = useSessionsStore.getState().active?.workspacePath
      if (!ws) return
      usePreviewStore.getState().setUrl(ws, `${convertFileSrc(absPath)}?t=${Date.now()}`)
      setPanelMode("preview")
    },
    [setPanelMode],
  )
  const onBuildSdd = async (draftId: string, planPath: string) => {
    const ws = useSddStore.getState().drafts[draftId]?.workspacePath
    if (!ws) return
    useSddStore.getState().setStage(draftId, "build")
    void useSddStore.getState().applyTrace(draftId, "building")
    await create(settings.defaultProvider, settings.defaultModel, ws)
    void onSend(tStatic("sdd.prompt.build", { path: planPath }))
  }
  useSuggestionsAuto(activeStreaming, setPanelMode)
  const activeEmpty = useSessionsStore(
    (s) => (s.active?.messages.length ?? 0) === 0 && s.loadingMsgId !== s.activeId,
  )
  const splitEmpty = useSessionsStore((s) =>
    splitId ? (s.sessions[splitId]?.messages.length ?? 0) === 0 : false,
  )
  const sessionIndex = useSessionsStore((s) => s.index)
  const splitStreaming = useSessionsStore((s) => (splitId ? !!s.streamingIds[splitId] : false))
  const splitCompacting = useSessionsStore((s) => (splitId ? !!s.compactingIds[splitId] : false))
  const splitTitle = useSessionsStore((s) => (splitId ? s.sessions[splitId]?.title : undefined))
  const queuedActive = useSessionsStore((s) => (s.activeId ? s.queued[s.activeId] : undefined))
  const queuedSplit = useSessionsStore((s) => (splitId ? s.queued[splitId] : undefined))
  const enqueueMessage = useSessionsStore((s) => s.enqueueMessage)
  const dequeueMessage = useSessionsStore((s) => s.dequeueMessage)
  const removeQueuedAt = useSessionsStore((s) => s.removeQueuedAt)
  // Session-scoped error banner. A single global string leaked across chats: an
  // error raised in one session kept showing after switching away, and a
  // background stream's error surfaced on whatever session was active. Now the
  // banner only renders when its owning session is the active one.
  const [error, setError] = useState<{ sid: string | null; message: string } | null>(null)
  // Raise an error against the session the user is currently viewing (UI actions
  // such as send / fork / revert / slash commands always target the active chat).
  const raiseError = useCallback((message: string) => {
    setError({ sid: useSessionsStore.getState().activeId, message })
  }, [])
  const clearError = useCallback(() => setError(null), [])
  const runRoutineRef = useRef<(r: Routine) => Promise<void>>(async () => {})
  const forceQuitRef = useRef(false)
  const monitorRespondRef = useRef<(sessionId: string, line: string) => void>(() => {})
  const deliverPeerRef = useRef<(toSessionId: string, fromLabel: string, text: string) => void>(
    () => {},
  )
  const menuRef = useRef<{
    newChat: () => void
    newProject: () => void
    toggleSplit: () => void
    settings: () => void
  }>({ newChat: () => {}, newProject: () => {}, toggleSplit: () => {}, settings: () => {} })

  useEffect(() => {
    const onOpenPane = (e: Event) => {
      const id = (e as CustomEvent<{ workerId?: string }>).detail?.workerId
      const sid = useSessionsStore.getState().activeId
      if (!id || !sid) return
      changeSplit(null)
      setAgentPane(sid, id)
    }
    const onPreviewNav = (e: Event) => {
      const sid = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (sid && sid === useSessionsStore.getState().activeId) {
        markAiOpened("preview")
        setPanelMode("preview")
      }
    }
    window.addEventListener("codezal:open-agent-pane", onOpenPane as EventListener)
    window.addEventListener("codezal:preview-navigate", onPreviewNav as EventListener)
    return () => {
      window.removeEventListener("codezal:open-agent-pane", onOpenPane as EventListener)
      window.removeEventListener("codezal:preview-navigate", onPreviewNav as EventListener)
    }
  }, [changeSplit, setPanelMode, setAgentPane, markAiOpened])

  useEffect(() => {
    const onDrag = (e: Event) => {
      const active = (e as CustomEvent<{ active?: boolean }>).detail?.active
      setSessionDragActive(!!active)
    }
    window.addEventListener("codezal:session-drag", onDrag as EventListener)
    return () => window.removeEventListener("codezal:session-drag", onDrag as EventListener)
  }, [])

  useEffect(() => {
    dropSessionRef.current = onDropSessionId
  })
  useEffect(() => {
    const el = openZoneRef.current
    if (!el) return
    return registerDropTarget({
      el,
      accepts: "session",
      onDrop: (id) => dropSessionRef.current(id),
    })
  }, [sessionDragActive, splitId, agentPaneId])
  useEffect(() => {
    const el = splitPaneRef.current
    if (!el) return
    return registerDropTarget({
      el,
      accepts: "session",
      onDrop: (id) => dropSessionRef.current(id),
    })
  }, [splitId])

  useBootStores()
  useBootDraft(settings, settingsLoaded)

  // Drain the text queue only when the session can actually accept a turn.
  // Dequeueing while the session is busy (stream / pre-stream preparation /
  // compaction) would lose the message to the gate's re-queue or the
  // "Bağlam sıkıştırılıyor" rejection. `activeSessionId` is a dep so a queue
  // that filled while the session was in the background drains on switch-back.
  useEffect(() => {
    if (activeStreaming || activeCompacting) return
    const sid = useSessionsStore.getState().activeId
    if (!sid || preparingTurns.has(sid)) return
    if ((useSessionsStore.getState().queued[sid]?.length ?? 0) === 0) return
    const next = dequeueMessage(sid)
    if (next) void onSend(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStreaming, activeCompacting, activeSessionId])

  useEffect(() => {
    if (splitStreaming || splitCompacting || !splitId) return
    if (preparingTurns.has(splitId)) return
    if ((useSessionsStore.getState().queued[splitId]?.length ?? 0) === 0) return
    const next = dequeueMessage(splitId)
    if (next) void onSendSplit(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitStreaming, splitCompacting, splitId])

  // mac+win ortak; child-process kill'i jobs.ts beforeunload'u destroy() unload'unda
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let unlistenTrayQuit: (() => void) | undefined
    let disposed = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const w = getCurrentWindow()
        // teardown dinamik import — App, TerminalPanel'e (xterm) / mcp'ye statik
        const shutdownAndDestroy = async () => {
          try {
            await Promise.allSettled([
              useSessionsStore.getState().persistAllPending(),
              import("@/components/TerminalPanel").then((m) => m.flushTerminalSnapshots()),
              import("@/lib/mcp").then((m) => m.disconnectAll()),
            ])
          } finally {
            await w.destroy()
          }
        }
        unlisten = await w.onCloseRequested(async (event) => {
          event.preventDefault()
          const bg = !!useSettingsStore.getState().settings.autopilot?.runInBackground
          if (bg && !forceQuitRef.current) {
            try {
              await w.hide()
            } catch {
              // Intentionally ignored.
            }
            return
          }
          await shutdownAndDestroy()
        })
        const { listen } = await import("@tauri-apps/api/event")
        unlistenTrayQuit = await listen("codezal:tray-quit", () => {
          forceQuitRef.current = true
          void shutdownAndDestroy()
        })
      } catch {
        // Intentionally ignored.
      }
      if (disposed) {
        unlisten?.()
        unlistenTrayQuit?.()
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
      unlistenTrayQuit?.()
    }
  }, [])

  useEffect(() => installTooltipSuppressor(), [])

  useEffect(() => {
    if (!settingsLoaded) return
    const presentUpdate = (u: Update | null) => {
      if (!u) return
      const st = useUpdateStore.getState()
      if (st.phase === "downloading" || st.phase === "installing") return
      // Same version already shown/snoozed — don't pop the card back open.
      if (st.update && st.update.version === u.version) return
      st.present(u)
    }
    void checkForUpdateOnLaunch().then(presentUpdate)
    // Keep checking while the app stays open so a release published mid-session
    // still surfaces without a restart.
    const id = setInterval(() => {
      void checkForUpdateOnLaunch().then(presentUpdate)
    }, UPDATE_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [settingsLoaded])

  useEffect(() => {
    runRoutineRef.current = async (r: Routine) => {
      try {
        const provider = (r.provider as ProviderId | undefined) ?? settings.defaultProvider
        const model = r.model ?? settings.defaultModel
        // Route the turn to the created session by id instead of via the active
        // session: with concurrent fires, `active` can be overwritten by another
        // routine between create() and the send, misdelivering the prompt.
        const sid = await create(provider, model, settings.defaultWorkspacePath, r.reasoningEffort, r.path)
        void dispatchTurn(sid, r.prompt)
      } catch (e) {
        console.warn(`[scheduler] '${r.name}' fire failed:`, e)
      }
    }
  })

  useEffect(() => {
    if (!settingsLoaded) return
    void startScheduler({
      workspacePath,
      onFire: (r) => void runRoutineRef.current(r),
    })
    return () => stopScheduler()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded])

  useEffect(() => {
    monitorRespondRef.current = (sessionId, line) => {
      void (async () => {
        try {
          await open(sessionId)
          // Same id-routed dispatch as runRoutine — avoids misdelivery when a
          // routine fires between open() and the send.
          void dispatchTurn(sessionId, `[monitor] ${line}`)
        } catch (e) {
          console.warn("[monitor] respond failed:", e)
        }
      })()
    }
  })

  useEffect(() => {
    return subscribeMonitor((ev) => monitorRespondRef.current(ev.sessionId, ev.line))
  }, [])

  useEffect(() => {
    deliverPeerRef.current = (toSessionId, fromLabel, text) => {
      void (async () => {
        try {
          if (!useSessionsStore.getState().sessions[toSessionId]) {
            await loadIntoPool(toSessionId)
          }
          enqueueInbox(toSessionId, { fromLabel, text, at: Date.now() })
          if (useSessionsStore.getState().activeId !== toSessionId) {
            void useSessionsStore.getState().patchSessionMeta(toSessionId, { unread: true })
          }
          if (useSessionsStore.getState().streamingIds[toSessionId]) return
          const sess = useSessionsStore.getState().sessions[toSessionId]
          if (!sess) return
          const msg = takeInbox(toSessionId)
          if (!msg) return
          const content = framePeerMessage(msg.fromLabel, msg.text)
          const userMsg: Message = {
            id: createId("message"),
            role: "user",
            content,
            modelMsgCount: 1,
          }
          const asstMsg: Message = {
            id: createId("message"),
            role: "assistant",
            content: "",
            parts: [],
            pending: true,
          }
          useSessionsStore.getState().pushMessageFor(toSessionId, userMsg)
          useSessionsStore.getState().pushMessageFor(toSessionId, asstMsg)
          const history: ModelMessage[] = [
            ...(sess.modelMessages ?? []),
            { role: "user", content },
          ]
          await runStream(toSessionId, asstMsg.id, history)
        } catch (e) {
          console.warn("[peer-msg] teslim başarısız:", e)
        }
      })()
    }
  })

  useEffect(() => {
    return subscribeSessionMessage((ev) =>
      deliverPeerRef.current(ev.toSessionId, ev.fromLabel, ev.text),
    )
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    void refreshScheduler(workspacePath)
  }, [workspacePath, settingsLoaded])

  const codeMapEnabled = useSettingsStore((s) => s.settings.tokenSavers?.codeMap.enabled ?? false)
  const codeMapBuildingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!settingsLoaded || !codeMapEnabled || !workspacePath) return
    const ws = workspacePath
    if (codeMapBuildingRef.current.has(ws)) return
    let cancelled = false
    void (async () => {
      let built = false
      try {
        const st = await invoke<{ symbols: number }>("codemap_status", { workspace: ws })
        built = st.symbols > 0
      } catch {
        // Intentionally ignored.
      }
      if (cancelled || built) return // Already installed; leave it alone.
      codeMapBuildingRef.current.add(ws)
      try {
        await invoke("codemap_build", { workspace: ws })
      } catch {
        // Intentionally ignored.
      } finally {
        codeMapBuildingRef.current.delete(ws)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspacePath, settingsLoaded, codeMapEnabled])

  const codeMapAutoReindex = useSettingsStore(
    (s) => s.settings.tokenSavers?.codeMap.autoReindex ?? true,
  )
  useEffect(() => {
    if (!settingsLoaded || !codeMapEnabled || !codeMapAutoReindex || !workspacePath) return
    const ws = workspacePath
    const root = ws.replace(/\\/g, "/").replace(/\/$/, "")
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let unwatch: (() => void) | undefined
    const pending = new Set<string>()
    const flush = () => {
      const rels = [...pending]
      pending.clear()
      if (rels.length === 0) return
      void invoke("codemap_reindex_files", { workspace: ws, rels }).catch(() => {})
    }
    void watchWorkspace(ws, (ev) => {
      const p = ev.path.replace(/\\/g, "/")
      if (!p.startsWith(`${root}/`)) return
      pending.add(p.slice(root.length + 1))
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 1500)
    })
      .then((fn) => {
        if (disposed) fn()
        else unwatch = fn
      })
      .catch(() => {})
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unwatch?.()
    }
  }, [workspacePath, settingsLoaded, codeMapEnabled, codeMapAutoReindex])

  useEffect(() => {
    if (!settingsLoaded) return
    void setAutostart(!!settings.autopilot?.autostart)
  }, [settingsLoaded, settings.autopilot?.autostart])

  // Keep-awake: prevent system idle-sleep while streaming or when the user
  // explicitly enabled the autopilot keep-awake toggle.
  const keepAwakeSetting = !!settings.autopilot?.keepAwake
  useEffect(() => {
    if (!settingsLoaded) return
    void setKeepAwake(anyStreaming || keepAwakeSetting)
  }, [settingsLoaded, anyStreaming, keepAwakeSetting])

  // Appearance: apply theme presets, fonts, motion flags, etc. Follow OS changes when mode='system'.
  useEffect(() => {
    const appearance = settings.appearance ?? DEFAULT_APPEARANCE
    applyAppearance(appearance, userThemes)
    if (appearance.mode !== "system") return
    return watchSystemTheme(() => applyAppearance(appearance, userThemes))
  }, [settings.appearance, userThemes])

  // Load user theme JSONs from $HOME/.codezal/themes once settings have hydrated.
  useEffect(() => {
    if (!settingsLoaded) return
    void loadUserThemes().then(setUserThemes)
  }, [settingsLoaded])

  // Legacy font-scale (Tauri webview zoom) — preserved alongside the new px-based font sizes.
  useEffect(() => {
    void applyFontScale(settings.fontScale)
  }, [settings.fontScale])

  // Auto-open settings once after hydration when no API key is configured.
  // Render-phase guard avoids setState-in-effect cascading renders.
  const [autoOpenedSettings, setAutoOpenedSettings] = useState(false)
  if (!autoOpenedSettings && settingsLoaded && settings.onboardingCompleted && Object.keys(settings.apiKeys).length === 0) {
    setAutoOpenedSettings(true)
    setShowSettings(true)
  }

  // Auto-heal default provider — DEFAULT.defaultProvider is "openai", but if
  // the user never connected OpenAI (no apiKey, no oauth, no env), the
  // settings UI silently displays the first connected provider while the
  // stored value stays stale. That leaks into createDraft() below and every
  // new chat opens with the wrong (unauthenticated) provider. Probe env vars
  // once after load, then rewrite settings + any in-flight draft.
  useEffect(() => {
    if (!settingsLoaded) return
    let alive = true
    void (async () => {
      const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
      const adapters = listProviderAdapters(catalog)
      if (adapters.length === 0) return
      const envVars = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
      const envHits = envVars.length > 0 ? await probeEnvVars(envVars) : {}
      if (!alive) return
      const current = adapters.find((p) => p.id === settings.defaultProvider)
      const currentOk = !!current && isConnectedSync(current, settings, envHits)
      if (currentOk) return
      const next = adapters.find((p) => isConnectedSync(p, settings, envHits))
      if (!next) return // none connected — leave as-is; user sees the "no providers" UI
      const nextModel = defaultModelFor(next.id, catalog)
      const oldProvider = settings.defaultProvider
      void updateSettings({ defaultProvider: next.id, defaultModel: nextModel })
      // Already-created draft inherits the stale provider — patch it too so
      // the composer immediately reflects the healed default.
      const sst = useSessionsStore.getState()
      if (sst.isDraft && sst.active && sst.active.provider === oldProvider) {
        updateActiveMeta({ provider: next.id, model: nextModel })
      }
    })()
    return () => {
      alive = false
    }
  }, [
    settingsLoaded,
    settings,
    updateSettings,
    updateActiveMeta,
  ])



  useKeyboardShortcuts({
    openNewSession,
    setShowPalette,
    setShowSettings,
    setShowSearch,
    setShowChatSearch,
    setShowForkDialog,
    setPanelMode,
    toggleTerminal: toggleTerminalTab,
    menuRef,
  })

  useEffect(() => {
    menuRef.current = {
      newChat: () => void openNewSession(false),
      newProject: () => void onNewProject(),
      toggleSplit: () => void toggleSplit(),
      settings: () => setShowSettings(true),
    }
  })

  useEffect(() => {
    let unlisteners: Array<() => void> = []
    let disposed = false
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const subs = await Promise.all([
          listen("menu:new-chat", () => menuRef.current.newChat()),
          listen("menu:new-project", () => menuRef.current.newProject()),
          listen("menu:toggle-split", () => menuRef.current.toggleSplit()),
          listen("menu:settings", () => menuRef.current.settings()),
        ])
        if (disposed) subs.forEach((u) => u())
        else unlisteners = subs
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      disposed = true
      unlisteners.forEach((u) => u())
    }
  }, [])

  // Hysteresis: trigger %90 → target %40 (settings.autoCompact'tan).
  const recordAuxUsage = (
    sid: string,
    u: Awaited<ReturnType<typeof generateText>>["usage"] | undefined,
    prov: ProviderId,
    mdl: string,
  ) => {
    const input = u?.inputTokens ?? 0
    const output = u?.outputTokens ?? 0
    if (input === 0 && output === 0) return
    const cacheRead = (u as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0
    useSessionsStore.getState().addUsageFor(sid, {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      reasoningTokens: (u as { reasoningTokens?: number } | undefined)?.reasoningTokens ?? 0,
      costUsd: costUsd(
        mdl,
        { input, output, cacheRead },
        catalogPricing(settings.providerCatalog?.data as ProvidersCatalog | undefined, prov, mdl),
      ),
      countTurn: false,
    })
  }

  const runStream = makeRunStream({
    setError: (message, sid) =>
      setError((prev) => (message === null ? (prev?.sid === sid ? null : prev) : { sid, message })),
    recordAuxUsage,
    sanitizeHistoryForProvider,
  })
  // Register the stream function so worker-session dispatch can run full
  // session streams for parallel agents.
  setWorkerStreamFn((sid, asstMsgId, history) => runStream(sid, asstMsgId, history))

  async function runCompaction(sid: string, force = false): Promise<boolean> {
    if (compactionInFlight.has(sid)) return false
    compactionInFlight.add(sid)
    try {
      return await runCompactionInner(sid, force)
    } finally {
      compactionInFlight.delete(sid)
    }
  }

  async function runCompactionInner(sid: string, force = false): Promise<boolean> {
    const snap = useSessionsStore.getState().sessions[sid]
    if (!snap) return false
    const msgs = snap.modelMessages ?? []
    if (msgs.length < 4) return false

    const compactCatalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
    const limits = {
      context: resolveContextCap(
        compactCatalog,
        snap.provider,
        snap.model,
        settings.customProviders,
      ),
      output: modelDetail(compactCatalog, snap.provider, snap.model)?.limit?.output,
    }
    // Compact decision follows the SAME number the gauge shows the user
    // (effectiveContextTokens from context-gauge). Cold-start / reloaded
    // sessions without a stamped gauge fall back to the local estimate.
    const eff = snap.usage?.effectiveContextTokens || estimateMessagesTokens(msgs)
    if (!force && !shouldCompact(eff, snap.model, settings.autoCompact, limits)) {
      return false
    }

    let working = msgs
    const { messages: pruned, prunedTokens } = pruneToolOutputs(msgs)
    if (prunedTokens > 0) {
      working = pruned
      // afterPrune drives ONLY the compact decision. We deliberately do NOT
      // overwrite the persisted gauge here: the model's reported gauge still
      // includes prefix-cache reads that pruning can't invalidate until the
      // next step re-evaluates the cache, so stamping a heuristic guess would
      // recreate the fake drop-then-reinflate flicker the gauge exists to
      // avoid. The next step's onStepEnd writes the true post-prune size.
      const afterPrune = Math.max(0, eff - prunedTokens)
      useSessionsStore.getState().replaceModelMessagesFor(sid, pruned)
      if (!force && !shouldCompact(afterPrune, snap.model, settings.autoCompact, limits)) {
        console.info(`[compact] prune yeterli: ${eff} → ${afterPrune} (~${prunedTokens} tok budandı)`)
        // Surface the prune — previously this path was silent, so old tool
        // outputs vanished from the model's context with no visible trace.
        useSessionsStore.getState().pushMessageFor(sid, {
          id: createId("message"),
          role: "system",
          content: tStatic("app.compactPrunedOnly", { tokens: prunedTokens.toLocaleString() }),
        })
        return true
      }
    }

    const { pushMessageFor, patchMessageFor, setCompactingFor } = useSessionsStore.getState()
    const statusId = createId("message")
    pushMessageFor(sid, {
      id: statusId,
      role: "system",
      content: "Bağlam sıkıştırılıyor…",
      compacting: true,
    })
    setCompactingFor(sid, true)

    const preCompactHook = runHooks({
      hooks: getEffectiveSettings(snap.workspacePath).hooks,
      event: "PreCompact",
      payload: { tokenCount: estimateMessagesTokens(working) },
      workspace: snap.workspacePath,
    }).catch((e) => console.warn("[hook] PreCompact error:", e))
    await Promise.race([
      preCompactHook,
      new Promise<void>((resolve) => setTimeout(resolve, PRECOMPACT_HOOK_TIMEOUT_MS)),
    ])

    try {
      const { messages: compacted, usage, usedProvider, usedModel } = await compactMessages({
        messages: working,
        appSettings: settings,
        activeProvider: snap.provider,
        activeModel: snap.model,
        settings: settings.autoCompact,
      })
      if (usedProvider && usedModel) recordAuxUsage(snap.id, usage, usedProvider, usedModel)

      let finalMsgs = compacted
      let newEff = estimateMessagesTokens(compacted)
      const target = targetTokensAfterCompact(snap.model, settings.autoCompact, limits)
      if (newEff > target) {
        console.warn(
          `[compact] hedef altı: ${newEff} > ${target} — keepLast=${settings.autoCompact.keepLast} azaltılabilir`,
        )
      }
      if (newEff >= compactTrigger(snap.model, settings.autoCompact, limits)) {
        const { messages: hp, prunedTokens } = pruneToolOutputs(finalMsgs, {
          tailTurns: 0,
          protectTokens: RECENT_TOOL_PROTECT_TOKENS,
          minGain: 1,
        })
        if (prunedTokens > 0) {
          finalMsgs = hp
          newEff = estimateMessagesTokens(hp)
          console.info(`[compact] agresif prune fallback: ~${prunedTokens} tok budandı → ${newEff}`)
        }
      }

      useSessionsStore.getState().replaceModelMessagesFor(sid, finalMsgs)
      useSessionsStore.getState().setEffectiveContextTokensFor(sid, newEff)
      const pct = eff > 0 ? Math.round((1 - newEff / eff) * 100) : 0
      if (pct === 0 && !force) {
        useSessionsStore.getState().deleteMessageFor(sid, statusId)
        return true
      }
      patchMessageFor(sid, statusId, {
        compacting: false,
        content:
          pct > 0
            ? `✓ Sıkıştırıldı: ~${eff.toLocaleString()} → ~${newEff.toLocaleString()} token (-${pct}%)`
            : "Zaten kompakt — sıkıştırılacak eski içerik yok.",
      })
      return true
    } catch (e) {
      console.error("[compact] başarısız:", e)
      const msg = errorMessage(e)
      raiseError(tStatic("app.compactFailed", { message: msg }))
      patchMessageFor(sid, statusId, {
        compacting: false,
        content:
          prunedTokens > 0
            ? `⚠ Özet başarısız — ama ~${prunedTokens.toLocaleString()} token budandı.`
            : "Sıkıştırma tamamlanamadı.",
      })
      return false
    } finally {
      setCompactingFor(sid, false)
    }
  }

  async function onSend(
    text: string,
    images?: MessageImage[],
    override?: SendOverride,
    meta?: string,
    // baloncukta chip render edilir.
    files?: MessageFile[],
    pdfs?: MessagePdf[],
  ) {
    clearError()

    const sessSt = useSessionsStore.getState()
    if (sessSt.active && sessSt.isDraft) {
      await sessSt.commitDraft()
    } else if (!sessSt.active) {
      await create(
        settings.defaultProvider,
        settings.defaultModel,
        settings.defaultWorkspacePath,
      )
    }

    const activeNow = useSessionsStore.getState().active
    if (!activeNow) return
    await dispatchTurn(activeNow.id, text, images, override, meta, files, pdfs)
  }

  // AI Review (PRPanel "AI Review" butonu) → mevcut /review komutunu subtask olarak
  useEffect(() => {
    const onRunReview = (e: Event) => {
      const args = (e as CustomEvent<{ args?: string }>).detail?.args ?? ""
      const rendered = renderTemplate(REVIEW_TEMPLATE, args).trim()
      if (!rendered) return
      const compact = `/review${args ? ` ${args}` : ""}`
      const body = `Bunu bir alt-görev olarak \`spawn_agent\` ile çalıştır ve sonucu özetle:\n\n${rendered}`
      void onSend(compact, undefined, undefined, body)
    }
    window.addEventListener("codezal:run-review", onRunReview as EventListener)
    return () => window.removeEventListener("codezal:run-review", onRunReview as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Status-bar CI-checks badge → open the git panel and switch it to the PR view.
  useEffect(() => {
    const onOpenPr = () => {
      setPanelMode("git")
      requestOpenPrView()
    }
    window.addEventListener("codezal:open-pr-view", onOpenPr)
    return () => window.removeEventListener("codezal:open-pr-view", onOpenPr)
  }, [setPanelMode])

  useEffect(() => {
    const onIssueToAgent = (e: Event) => {
      const d = (e as CustomEvent<{ repoPath?: string; number?: number; title?: string }>).detail
      if (!d?.repoPath || !d.number) return
      const repoPath = d.repoPath
      const number = d.number
      const title = d.title ?? ""
      void (async () => {
        try {
          const base = (await gitDefaultBranch(repoPath)) ?? "main"
          const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40)
          const branch = `codezal/issue-${number}${slug ? `-${slug}` : ""}`
          const wt = await createWorktree({ repoPath, branch, baseRef: base })
          let body = ""
          try {
            const tok = await getGithubToken()
            const repo = await resolveRepo(repoPath)
            if (tok && repo) body = (await getIssue(tok, repo, number)).body
          } catch {
            // Intentionally ignored.
          }
          const cur = useSessionsStore.getState().active
          await create(
            cur?.provider ?? settings.defaultProvider,
            cur?.model ?? settings.defaultModel,
            wt.path,
          )
          await onSend(buildIssueAgentPrompt({ number, title, body, base, branch }))
          toast.success(tStatic("prPanel.issueAgentStarted", { n: number, branch }))
        } catch (err) {
          toast.error(tStatic("prPanel.issueAgentFailed", { message: errorMessage(err) }))
        }
      })()
    }
    window.addEventListener("codezal:issue-to-agent", onIssueToAgent as EventListener)
    return () => window.removeEventListener("codezal:issue-to-agent", onIssueToAgent as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onTermAi = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (!text?.trim()) return
      void onSend(buildTerminalAiPrompt(text))
    }
    window.addEventListener("codezal:terminal-to-ai", onTermAi as EventListener)
    return () => window.removeEventListener("codezal:terminal-to-ai", onTermAi as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-commit review "Fix with AI" → run the fix prompt in the session that
  // produced the change (open it first), or a brand-new session when no session
  // overlaps the diff, so an unrelated chat is never mutated.
  useEffect(() => {
    const onFix = (e: Event) => {
      const d = (
        e as CustomEvent<{
          prompt?: string
          targetSessionId?: string | null
          workspace?: string
        }>
      ).detail
      if (!d?.prompt) return
      setPanelMode(null)
      void (async () => {
        const store = useSessionsStore.getState()
        if (d.targetSessionId && store.sessions[d.targetSessionId]) {
          await store.open(d.targetSessionId)
        } else {
          const cur = store.active
          await create(
            cur?.provider ?? settings.defaultProvider,
            cur?.model ?? settings.defaultModel,
            d.workspace ?? settings.defaultWorkspacePath,
          )
        }
        await onSend(d.prompt as string)
      })()
    }
    window.addEventListener("codezal:fix-review-findings", onFix as EventListener)
    return () =>
      window.removeEventListener("codezal:fix-review-findings", onFix as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  //   provider/model/workspace'iyle create + onSend).
  useEffect(() => {
    const onRun = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt
      if (!prompt) return
      // Acted on → drop the source session's suggestions (also dismisses its nudge).
      const prevSid = useSessionsStore.getState().activeId
      if (prevSid) useSuggestionsStore.getState().clearFor(prevSid)
      setPanelMode(null)
      void (async () => {
        const cur = useSessionsStore.getState().active
        await create(
          cur?.provider ?? settings.defaultProvider,
          cur?.model ?? settings.defaultModel,
          cur?.workspacePath ?? settings.defaultWorkspacePath,
        )
        await onSend(prompt)
      })()
    }
    const onOpen = () => setPanelMode("suggestions")
    const onRegen = () => void triggerSuggestionsFor(useSessionsStore.getState().activeId)
    window.addEventListener("codezal:run-suggestion", onRun as EventListener)
    window.addEventListener("codezal:open-suggestions", onOpen)
    window.addEventListener("codezal:regenerate-suggestions", onRegen)
    return () => {
      window.removeEventListener("codezal:run-suggestion", onRun as EventListener)
      window.removeEventListener("codezal:open-suggestions", onOpen)
      window.removeEventListener("codezal:regenerate-suggestions", onRegen)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSendSplit(
    text: string,
    images?: MessageImage[],
    override?: SendOverride,
    meta?: string,
    files?: MessageFile[],
    pdfs?: MessagePdf[],
  ) {
    clearError()
    if (!splitId) return
    if (!useSessionsStore.getState().sessions[splitId]) return
    await useSessionsStore.getState().commitDetached(splitId)
    await dispatchTurn(splitId, text, images, override, meta, files, pdfs)
  }

  // M7: if a preparing turn throws or early-returns before a stream starts,
  // none of the drain-effect deps change, so a queued message would sit stuck.
  // Retry the drain for this session right after the turn leaves "preparing".
  function tryDrainQueueFor(sid: string): void {
    const st = useSessionsStore.getState()
    if (st.streamingIds[sid] || st.compactingIds[sid]) return
    if (preparingTurns.has(sid)) return
    if ((st.queued[sid]?.length ?? 0) === 0) return
    if (sid === st.activeId) {
      const next = st.dequeueMessage(sid)
      if (next) void onSend(next)
    } else if (sid === splitId) {
      const next = st.dequeueMessage(sid)
      if (next) void onSendSplit(next)
    }
  }

  // settings warm → UserPromptSubmit hook → auto-compaction → user/asst push →
  // history kur → runStream.
  async function dispatchTurn(
    sid: string,
    text: string,
    images?: MessageImage[],
    override?: SendOverride,
    meta?: string,
    files?: MessageFile[],
    pdfs?: MessagePdf[],
  ) {
    const sess = useSessionsStore.getState().sessions[sid]
    if (!sess) return
    // Turn gate — BEFORE any message is pushed. runStream is single-flight per
    // session: a send that lands while a stream (or the pre-stream preparation
    // in dispatchTurnInner) is in flight would push a user message that never
    // reaches modelMessages (the model never sees it) plus a pending bubble
    // that spins forever. Queue plain text exactly like the Composer does;
    // reject attachments/meta sends with a toast since the queue is text-only.
    const gate = decideTurnGate({
      streaming: !!useSessionsStore.getState().streamingIds[sid],
      preparing: preparingTurns.has(sid),
      hasAttachments:
        meta !== undefined ||
        (images?.length ?? 0) > 0 ||
        (files?.length ?? 0) > 0 ||
        (pdfs?.length ?? 0) > 0,
    })
    if (gate === "queue") {
      useSessionsStore.getState().enqueueMessage(sid, text)
      return
    }
    if (gate === "reject") {
      toast.info(tStatic("app.turnBusyAttachments"))
      return
    }
    const spendCap = useSettingsStore.getState().settings.sessionSpendCapUsd ?? 0
    if (spendCap > 0 && (sess.usage?.costUsd ?? 0) >= spendCap) {
      toast.error(tStatic("app.spendCapReached", { cap: spendCap.toFixed(2) }))
      return
    }
    if (useSessionsStore.getState().compactingIds[sid]) {
      raiseError("Bağlam sıkıştırılıyor — bitince tekrar deneyin.")
      return
    }

    preparingTurns.add(sid)
    try {
      await dispatchTurnInner(sid, text, images, override, meta, files, pdfs)
    } finally {
      preparingTurns.delete(sid)
      tryDrainQueueFor(sid)
    }
  }

  async function dispatchTurnInner(
    sid: string,
    text: string,
    images?: MessageImage[],
    override?: SendOverride,
    meta?: string,
    files?: MessageFile[],
    pdfs?: MessagePdf[],
  ) {
    const sess = useSessionsStore.getState().sessions[sid]
    if (!sess) return

    resetAttach(sid)

    useSessionsStore.getState().setTodosFor(sid, [])

    // Warm the project-config cache for this workspace so effective settings
    // (global merged with <ws>/.codezal/config.json) are available below and to
    // the synchronous reads (hooks, mcp) further down the flow.
    const effSettings = await resolveEffectiveSettings(sess.workspacePath)

    let effectiveText = text
    try {
      const hookRes = await runHooks({
        hooks: effSettings.hooks,
        event: "UserPromptSubmit",
        payload: { prompt: text },
        workspace: sess.workspacePath,
      })
      if (hookRes.extraContext) {
        effectiveText = `${text}\n\n<hook-context>\n${hookRes.extraContext}\n</hook-context>`
      }
    } catch (e) {
      console.warn("[hook] UserPromptSubmit error:", e)
    }

    if (settings.autoCompact.enabled) {
      await runCompaction(sid)
    }

    //
    if (meta !== undefined) {
      const metaMsg: Message = {
        id: createId("message"),
        role: "user",
        content: meta,
        meta: true,
        modelMsgCount: 1,
      }
      const visibleMsg: Message = {
        id: createId("message"),
        role: "user",
        content: text,
        modelMsgCount: 1,
      }
      const asstMsgM: Message = {
        id: createId("message"),
        role: "assistant",
        content: "",
        parts: [],
        pending: true,
      }
      const store = useSessionsStore.getState()
      store.pushMessageFor(sid, metaMsg)
      store.pushMessageFor(sid, visibleMsg)
      store.pushMessageFor(sid, asstMsgM)

      const snapM = useSessionsStore.getState().sessions[sid]!
      const metaModel = await buildUserContent(meta, undefined)
      const visibleModel = await buildUserContent(effectiveText)
      const turnUsers: ModelMessage[] = [
        { role: "user", content: metaModel },
        { role: "user", content: visibleModel },
      ]
      let historyM: ModelMessage[]
      if (snapM.modelMessages) {
        historyM = [...snapM.modelMessages, ...turnUsers]
      } else {
        const prior = messagesToModelMessages(snapM.messages.slice(0, -3))
        historyM = [...prior, ...turnUsers]
      }
      await runStream(sid, asstMsgM.id, historyM, override)
      void maybeAutoLearn(sid)
      return
    }

    const fileRefsText =
      files && files.length
        ? "\n\n" +
          files
            .map((f) => {
              const ws = sess.workspacePath
              const rel =
                ws && f.path.startsWith(ws)
                  ? f.path.slice(ws.length).replace(/^[/\\]/, "")
                  : f.path
              return `@${rel}`
            })
            .join("\n")
        : ""

    // Model native PDF (document block) destekliyor mu? — buildUserContent A/B
    const pdfNative = modelAcceptsPdf(
      settings.providerCatalog?.data as ProvidersCatalog | undefined,
      sess.provider,
      sess.model ?? "",
    )

    const userMsg: Message = {
      id: createId("message"),
      role: "user",
      content: text,
      ...(images && images.length ? { images } : {}),
      ...(files && files.length ? { files } : {}),
      ...(pdfs && pdfs.length ? { pdfs } : {}),
      modelMsgCount: 1,
    }
    const asstMsg: Message = {
      id: createId("message"),
      role: "assistant",
      content: "",
      parts: [],
      pending: true,
    }
    useSessionsStore.getState().pushMessageFor(sid, userMsg)
    useSessionsStore.getState().pushMessageFor(sid, asstMsg)

    const snap = useSessionsStore.getState().sessions[sid]!
    const userContent = await buildUserContent(effectiveText + fileRefsText, images, pdfs, pdfNative)
    let history: ModelMessage[]
    if (snap.modelMessages) {
      history = [...snap.modelMessages, { role: "user", content: userContent }]
    } else {
      history = messagesToModelMessages(snap.messages)
      const last = history[history.length - 1]
      if (last && last.role === "user") {
        history[history.length - 1] = { role: "user", content: userContent }
      }
    }

    await runStream(sid, asstMsg.id, history, override)
    void maybeAutoLearn(sid)
  }

  async function onNewProject() {
    const path = await pickWorkspaceFolder()
    if (!path) return
    await addProject(path)
    const d = resolveSessionDefaults(useSessionsStore.getState().projectMeta[path], settings)
    createDraft(d.provider, d.model, path)
    setShowSettings(false)
    setShowRoutines(false)
  }

  function toggleSplit() {
    if (splitId) {
      changeSplit(null)
      return
    }
    setAgentPane(activeSessionId, null)
    const id = useSessionsStore.getState().createDetached(
      settings.defaultProvider,
      settings.defaultModel,
      settings.defaultWorkspacePath,
    )
    setSplitId(id)
  }

  async function askSelectionInSplit(question: string) {
    clearError()
    const store = useSessionsStore.getState()
    const cur = store.active
    const id = store.createDetached(
      cur?.provider ?? settings.defaultProvider,
      cur?.model ?? settings.defaultModel,
      cur?.workspacePath ?? settings.defaultWorkspacePath,
      cur?.reasoningEffort,
    )
    if (cur?.workspaceReadOnly === true) {
      store.updateMetaFor(id, { workspaceReadOnly: true })
    }
    setAgentPane(activeSessionId, null)
    changeSplit(id)
    try {
      await store.commitDetached(id)
      await dispatchTurn(id, question)
    } catch (err) {
      raiseError(errorMessage(err))
    }
  }

  function onDropSessionId(id: string) {
    if (!id) return
    void (async () => {
      try {
        await loadIntoPool(id)
      } catch (err) {
        raiseError(errorMessage(err))
        return
      }
      setAgentPane(activeSessionId, null)
      changeSplit(id)
    })()
  }

  async function cancelActiveRun(sid: string): Promise<boolean> {
    abortStream(sid)
    for (let i = 0; i < 150 && useSessionsStore.getState().streamingIds[sid]; i++) {
      await new Promise((r) => setTimeout(r, 20))
    }
    return !useSessionsStore.getState().streamingIds[sid]
  }

  async function onRegenerate(userMsgId: string) {
    const sid = useSessionsStore.getState().activeId
    if (!sid) return
    clearError()
    if (!(await cancelActiveRun(sid))) {
      console.warn("[regenerate] aktif stream durmadı — kesim iptal edildi")
      return
    }
    truncateAfter(userMsgId)
    const snap = useSessionsStore.getState().sessions[sid]
    if (!snap) return
    const asstMsg: Message = {
      id: createId("message"),
      role: "assistant",
      content: "",
      parts: [],
      pending: true,
    }
    useSessionsStore.getState().pushMessageFor(sid, asstMsg)
    const history: ModelMessage[] =
      snap.modelMessages ?? messagesToModelMessages(snap.messages)
    await runStream(sid, asstMsg.id, history)
  }

  function onEditUser(userMsgId: string, newText: string) {
    editMessage(userMsgId, newText)
    void onRegenerate(userMsgId)
  }

  async function onBranch(messageId: string, name?: string) {
    try {
      const newId = await forkAt(messageId)
      const nm = name?.trim()
      if (nm) await useSessionsStore.getState().patchSessionMeta(newId, { title: nm })
    } catch (e) {
      const msg = errorMessage(e)
      raiseError(msg)
    }
  }

  async function branchFromLast(name: string) {
    const sid = useSessionsStore.getState().activeId
    if (!sid) return
    const sess = useSessionsStore.getState().sessions[sid]
    const last = sess?.messages[sess.messages.length - 1]
    if (!last) return
    await onBranch(last.id, name)
  }

  async function onFork(srcId: string, prompt: string) {
    const p = prompt.trim()
    if (!p) {
      raiseError(tStatic("fork.needPrompt"))
      return
    }
    let forkId: string
    try {
      forkId = await useSessionsStore.getState().forkSessionBackground(srcId)
    } catch (e) {
      raiseError(errorMessage(e))
      return
    }
    toast.info(tStatic("fork.running"))
    try {
      await dispatchTurn(forkId, p)
    } catch (e) {
      toast.error(tStatic("fork.failed"))
      raiseError(errorMessage(e))
      return
    }
    const fork = useSessionsStore.getState().sessions[forkId]
    const lastAsst = fork
      ? [...fork.messages].reverse().find((m) => m.role === "assistant" && !m.pending)
      : undefined
    const resultText = (lastAsst?.content ?? "").trim()
    if (!resultText) {
      toast.error(tStatic("fork.failed"))
      return
    }
    const preview = p.replace(/\s+/g, " ").slice(0, 80)
    const store = useSessionsStore.getState()
    if (!store.sessions[srcId]) return
    const srcStreaming = !!store.streamingIds[srcId]
    store.pushMessageFor(srcId, {
      id: createId("message"),
      role: "assistant",
      content: `${tStatic("fork.resultHeader", { prompt: preview })}\n\n${resultText}`,
      modelMsgCount: srcStreaming ? 0 : 1,
    })
    if (!srcStreaming) {
      store.appendModelMessagesFor(srcId, [{ role: "assistant", content: resultText }])
    }
    toast.success(tStatic("fork.done"))
  }

  async function onRevert(messageId: string) {
    if (!window.confirm(tStatic("app.revertConfirm"))) {
      return
    }
    const sid = useSessionsStore.getState().activeId
    if (sid && !(await cancelActiveRun(sid))) {
      console.warn("[revert] aktif stream durmadı — revert iptal edildi")
      return
    }
    try {
      const r = await revertToBeforeMessage(messageId)
      useToastStore.getState().show(
        tStatic("app.revertDone", { restored: r.restored, deleted: r.deleted }),
        {
          kind: "success",
          duration: 8000,
          action: r.canUndo
            ? { label: tStatic("app.revertUndo"), onClick: () => void onUnrevert() }
            : undefined,
        },
      )
    } catch (e) {
      const msg = errorMessage(e)
      raiseError(tStatic("app.revertFailed", { message: msg }))
    }
  }

  async function onUnrevert() {
    try {
      const r = await unrevertSession()
      if (r) useToastStore.getState().show(tStatic("app.unrevertDone"), { kind: "success" })
    } catch (e) {
      raiseError(tStatic("app.revertFailed", { message: errorMessage(e) }))
    }
  }

  async function onRemember(noteText: string, scope: "project" | "global") {
    try {
      const ws = useSessionsStore.getState().active?.workspacePath
      const path = await appendMemory(scope, noteText, ws, undefined, "manual")
      toast.success(`${tStatic("toast.memorySaved")}: ${path}`)
    } catch (e) {
      raiseError(errorMessage(e))
    }
  }

  async function readExistingMemoryNotes(ws?: string): Promise<string> {
    try {
      const [proj, user] = await Promise.all([
        ws ? readProjectMemory(ws, { cache: true }) : Promise.resolve([]),
        readUserMemory({ cache: true }),
      ])
      return [...proj, ...user].map((f) => f.content).join("\n\n")
    } catch {
      return ""
    }
  }

  async function maybeAutoLearn(sid: string) {
    try {
      const cur = useSettingsStore.getState().settings
      const mem = cur.memory ?? DEFAULT_MEMORY
      if (!(mem.autoLearn ?? true)) return

      const sess = useSessionsStore.getState().sessions[sid]
      const msgs = sess?.modelMessages
      if (!sess || !msgs || msgs.length === 0) return

      const now = Date.now()
      if (!shouldLearn(sid, msgs.length, now)) return
      if (mem.autoLearnSkipToolChats && usedExternalTools(msgs)) return

      beginLearn(sid, msgs.length, now)
      try {
        const ws = sess.workspacePath
        const existingNotes = await readExistingMemoryNotes(ws)
        const learned = await extractMemories({
          messages: msgs.slice(-24),
          existingNotes,
          settings: cur,
          activeProvider: sess.provider,
          activeModel: sess.model ?? "",
          catalog: cur.providerCatalog?.data as ProvidersCatalog | undefined,
        })
        if (learned.length === 0) return

        const written: { scope: "project" | "global"; text: string }[] = []
        for (const m of learned) {
          try {
            await appendMemory(m.scope, m.text, ws, m.category, "auto_learn")
            written.push({ scope: m.scope, text: m.text })
          } catch {
            // Intentionally ignored.
          }
        }
        if (written.length === 0) return

        useToastStore.getState().show(tStatic("toast.memoryLearned", { count: written.length }), {
          kind: "success",
          duration: 8000,
          action: {
            label: tStatic("toast.memoryLearnedUndo"),
            onClick: () => {
              void (async () => {
                for (const w of written) {
                  try {
                    await removeMemoryNote(w.scope, w.text, ws)
                  } catch {
                    // geri-al best-effort
                  }
                }
                toast.info(tStatic("toast.memoryLearnedUndone"))
              })()
            },
          },
        })
      } finally {
        endLearn(sid)
      }
    } catch (e) {
      console.warn("[auto-learn] error:", e)
    }
  }

  // Composer slash komut aksiyonu — built-in eylemleri buradan dispatch.
  // ── Yan sohbet (/btw) ───────────────────────────────────────────────────
  async function runSideChat(sid: string, threadId: string, question: string) {
    if (sideChatBusy) return
    const store = useSessionsStore.getState()
    const cur = store.sessions[sid]
    if (!cur) return
    const thread = cur.sideChats?.find((tc) => tc.id === threadId)
    if (!thread) return

    const priorTurns = thread.messages
    const asstIdx = priorTurns.length + 1
    store.pushSideChatMsgFor(sid, threadId, { role: "user", content: question })
    store.pushSideChatMsgFor(sid, threadId, { role: "assistant", content: "", pending: true })
    setSideChatBusy(true)
    const ac = new AbortController()
    sideChatAbortRef.current = ac

    let textBuf = ""
    let reasoningBuf = ""
    let splitter: ThinkSplitter | null = null
    let rafId: number | null = null
    let flushTimerId: ReturnType<typeof setTimeout> | null = null
    let pendingPatch = false
    const flush = () => {
      rafId = null
      if (flushTimerId !== null) {
        clearTimeout(flushTimerId)
        flushTimerId = null
      }
      pendingPatch = false
      useSessionsStore.getState().patchSideChatMsgFor(sid, threadId, asstIdx, {
        content: textBuf,
        ...(reasoningBuf ? { reasoning: reasoningBuf } : {}),
        pending: true,
      })
    }
    const cancelSchedule = () => {
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
    const schedule = () => {
      if (pendingPatch) return
      pendingPatch = true
      rafId = requestAnimationFrame(flush)
      // rAF is suspended while the window is occluded / the app is napped and
      // the missed callback is not replayed on refocus, which would otherwise
      // freeze side-chat updates until the stream ends. A timer fires its
      // pending callback on resume, releasing the `pendingPatch` lock.
      flushTimerId = setTimeout(flush, 200)
    }

    try {
      const provider = cur.provider
      const modelId = cur.model
      if (inlinesThinkTags(provider, modelId)) {
        splitter = createThinkSplitter({
          onText: (s) => {
            textBuf += s
          },
          onReasoning: (s) => {
            reasoningBuf += s
          },
        })
      }
      const model = await buildLanguageModel({ providerId: provider, modelId, settings })
      const catalogData = settings.providerCatalog?.data as ProvidersCatalog | undefined
      const detail = modelDetail(catalogData, provider, modelId)
      const reasoningCapable = detail?.reasoning ?? false
      const outputLimit = detail?.limit?.output
      const effort = resolveReasoningEffort({
        providerId: provider,
        modelId,
        reasoningCapable,
        sessionEffort: cur.reasoningEffort,
        byModel: settings.reasoningEffortByModel,
      })
      const reasoningActive = reasoningCapable && effort !== "off"
      const context = sanitizeHistoryForProvider(
        (cur.modelMessages ?? []).slice(0, thread.contextBoundary),
      )
      const built = buildSideChatMessages(context, priorTurns, question, SIDE_CHAT_SYSTEM)
      const messages = transformHistory(
        built,
        provider,
        modelId,
        modelAcceptsImages(catalogData, provider, modelId),
      )
      const providerOptions = buildProviderOptions({
        providerId: provider,
        modelId,
        sessionId: sid,
        effort,
        reasoningCapable,
        outputLimit,
      })
      const result = streamText({
        model,
        allowSystemInMessages: true,
        messages,
        ...(Object.keys(providerOptions).length > 0
          ? { providerOptions: providerOptions as Parameters<typeof streamText>[0]["providerOptions"] }
          : {}),
        ...(reasoningActive ? {} : { maxOutputTokens: maxOutputTokens(outputLimit) }),
        abortSignal: ac.signal,
        experimental_transform: smoothStream({
          delayInMs: 3,
          chunking: (buffer: string) => (buffer.length > 0 ? buffer.slice(0, 1) : undefined),
        }),
        onError: ({ error }) => console.error("[side-chat] stream error:", error),
      })
      for await (const chunk of result.stream) {
        if (chunk.type === "text-delta") {
          if (splitter) splitter.feed(chunk.text ?? "")
          else textBuf += chunk.text ?? ""
          schedule()
        } else if (chunk.type === "reasoning-delta") {
          reasoningBuf += (chunk as { text?: string }).text ?? ""
          schedule()
        } else if (chunk.type === "error") {
          throw chunk.error instanceof Error ? chunk.error : new Error(errorMessage(chunk.error))
        }
      }
      cancelSchedule()
      splitter?.flush()
      useSessionsStore.getState().patchSideChatMsgFor(sid, threadId, asstIdx, {
        content: textBuf || "…",
        ...(reasoningBuf ? { reasoning: reasoningBuf } : {}),
        pending: false,
      })
    } catch (e) {
      cancelSchedule()
      splitter?.flush()
      const aborted = ac.signal.aborted
      useSessionsStore.getState().patchSideChatMsgFor(sid, threadId, asstIdx, {
        content: textBuf || (aborted ? "…" : `⚠️ ${errorMessage(e)}`),
        ...(reasoningBuf ? { reasoning: reasoningBuf } : {}),
        pending: false,
      })
    } finally {
      if (sideChatAbortRef.current === ac) sideChatAbortRef.current = null
      setSideChatBusy(false)
    }
  }

  function openSideChat(initialQuestion?: string) {
    const store = useSessionsStore.getState()
    const sid = store.activeId
    if (!sid) return
    const cur = store.sessions[sid]
    if (!cur) return
    let tid =
      sideChatThreadId && cur.sideChats?.some((tc) => tc.id === sideChatThreadId)
        ? sideChatThreadId
        : (cur.sideChats?.[cur.sideChats.length - 1]?.id ?? null)
    if (!tid) {
      const thread = newSideChatThread(cur.modelMessages?.length ?? 0)
      store.addSideChatFor(sid, thread)
      tid = thread.id
    }
    setSideChatThreadId(tid)
    setSideChatOpen(true)
    if (initialQuestion) void runSideChat(sid, tid, initialQuestion)
  }

  function newSideChatThreadAction() {
    const store = useSessionsStore.getState()
    const sid = store.activeId
    if (!sid) return
    const cur = store.sessions[sid]
    if (!cur) return
    const thread = newSideChatThread(cur.modelMessages?.length ?? 0)
    store.addSideChatFor(sid, thread)
    setSideChatThreadId(thread.id)
    setSideChatOpen(true)
  }

  async function onSlashAction(action: string, args: string) {
    switch (action) {
      case "clear":
        clearMessages()
        return
      case "side-chat":
        openSideChat(args.trim() || undefined)
        return
      case "branch":
        await branchFromLast(args)
        return
      case "fork": {
        const srcId = useSessionsStore.getState().activeId
        if (!srcId) return
        if (settings.forkSubagent) await onFork(srcId, args)
        else await branchFromLast(args)
        return
      }
      case "model":
        setPalettePage("model")
        setShowPalette(true)
        return
      case "workspace": {
        const path = await pickWorkspaceFolder()
        if (path) {
          useSessionsStore.getState().updateActiveMeta({ workspacePath: path })
          void useSettingsStore.getState().update({ defaultWorkspacePath: path })
        }
        return
      }
      case "search":
        setShowSearch(true)
        return
      case "routines":
        setShowRoutines(true)
        return
      case "settings":
        setSettingsTab(undefined)
        setShowSettings(true)
        return
      case "plugins":
        setSettingsTab("eklentiler")
        setShowSettings(true)
        return
      case "memory":
        setPanelMode("memory")
        return
      case "sdd": {
        const wsPath = useSessionsStore.getState().active?.workspacePath
        if (!wsPath) {
          raiseError(tStatic("sdd.workspaceRequired"))
          return
        }
        const title = args.trim() || tStatic("sdd.defaultTitle")
        const draft = await useSddStore.getState().createDraft(wsPath, title)
        const sid = await create(settings.defaultProvider, settings.defaultModel, wsPath)
        useSddStore.getState().linkSession(draft.id, sid)
        useSessionsStore.getState().updateActiveMeta({ title })
        setPanelMode("sdd")
        return
      }
      case "compact": {
        const aid = useSessionsStore.getState().activeId
        if (!aid) return
        // M4: compacting while a stream is in flight races the stream's final
        // modelMessages write — it would land after the compaction and wipe the
        // compacted history. Reject until the stream settles.
        if (useSessionsStore.getState().streamingIds[aid]) {
          toast.info(tStatic("app.compactBusy"))
          return
        }
        const before = useSessionsStore.getState().sessions[aid]?.modelMessages ?? []
        if (before.length < 4) {
          pushMessage({
            id: createId("message"),
            role: "system",
            content: "Sıkıştırılacak yeterli mesaj yok.",
          })
          return
        }
        await runCompaction(aid, true)
        return
      }
      case "rename": {
        const title = args.trim()
        if (title) useSessionsStore.getState().updateActiveMeta({ title })
        return
      }
      case "resume":
        setShowPalette(true)
        return
      case "stop": {
        const aid = useSessionsStore.getState().activeId
        if (aid) abortStream(aid)
        return
      }
      case "agent": {
        const sp = args.indexOf(" ")
        const name = sp === -1 ? args : args.slice(0, sp)
        const task = sp === -1 ? "" : args.slice(sp + 1).trim()
        if (!name) {
          raiseError(tStatic("app.agentNameRequired"))
          return
        }
        const text = task
          ? `\`spawn_agent\` ile **${name}** ajanını çağır ve şu görevi ver:\n\n${task}`
          : `\`spawn_agent\` ile **${name}** ajanını çağır.`
        void onSend(text)
        return
      }
      case "help":
        setShowHelp(true)
        return
      case "goal": {
        const trimmed = args.trim()
        if (trimmed.toLowerCase() === "stop" || trimmed.toLowerCase() === "cancel") {
          const cur = useSessionsStore.getState().active?.goal
          if (!cur) {
            pushMessage({
              id: createId("message"),
              role: "system",
              content: "Aktif goal yok.",
            })
            return
          }
          clearGoal()
          pushMessage({
            id: createId("message"),
            role: "system",
            content: `⏹ Goal iptal edildi: "${cur.text}"`,
          })
          return
        }
        if (trimmed.toLowerCase() === "resume") {
          const cur = useSessionsStore.getState().active?.goal
          if (!cur) {
            pushMessage({
              id: createId("message"),
              role: "system",
              content: "Aktif goal yok.",
            })
            return
          }
          if (!cur.paused) {
            pushMessage({
              id: createId("message"),
              role: "system",
              content: `Goal zaten aktif: "${cur.text}"`,
            })
            return
          }
          useSessionsStore.getState().resumeGoal()
          pushMessage({
            id: createId("message"),
            role: "system",
            content: `▶ Goal devam ediyor: "${cur.text}"`,
          })
          void onSend("Continue.")
          return
        }
        if (!trimmed) {
          raiseError("Goal metni gerekli — örn: /goal Tüm testler geçsin")
          return
        }
        setGoal(trimmed)
        pushMessage({
          id: createId("message"),
          role: "system",
          content: `🎯 Goal aktif: "${trimmed}"\nModel goal'i tamamlayana kadar her tur sonunda otomatik devam edecek. \`/goal stop\` ile iptal.`,
        })
        void onSend(`Start working on the goal. Goal: ${trimmed}`)
        return
      }
      case "codemap-index": {
        const ws = useSessionsStore.getState().active?.workspacePath
        if (!ws) {
          raiseError("Code Map: önce bir workspace klasörü bağla (/workspace).")
          return
        }
        const cur = useSettingsStore.getState().settings.tokenSavers ?? DEFAULT_TOKEN_SAVERS
        void useSettingsStore.getState().update({
          tokenSavers: { ...cur, codeMap: { ...cur.codeMap, enabled: true } },
        })
        pushMessage({
          id: createId("message"),
          role: "system",
          content: "⏳ Code Map index oluşturuluyor…",
        })
        try {
          const stats = await invoke<{ files: number; symbols: number }>("codemap_build", {
            workspace: ws,
          })
          pushMessage({
            id: createId("message"),
            role: "system",
            content: `✓ Code Map hazır: ${stats.symbols} sembol · ${stats.files} dosya. code_search / code_callers / code_callees / code_trace / code_impact araçları artık aktif.`,
          })
        } catch (e) {
          raiseError(`Code Map index başarısız: ${errorMessage(e)}`)
        }
        return
      }
    }
  }


  // Build the AI SDK user-message content from text + optional images/PDFs.
  // No attachments → plain string (unchanged behaviour). With attachments → a
  // parts array (empty text is dropped). Image parts carry the base64 data URL;
  // the AI SDK materializes them before the wire. PDF content is either a
  // native file part (when the model supports it) or extracted text.
  async function buildUserContent(
    text: string,
    images?: MessageImage[],
    pdfs?: MessagePdf[],
    // Model native PDF destekliyor mu (modalities.input "pdf"). true → AI SDK
    pdfNative?: boolean,
  ): Promise<
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; image: string; mediaType?: string }
        | { type: "file"; data: string; mediaType: string; filename?: string }
      >
  > {
    const hasImages = !!images && images.length > 0
    const hasPdfs = !!pdfs && pdfs.length > 0
    if (!hasImages && !hasPdfs) return text
    const parts: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string; mediaType?: string }
      | { type: "file"; data: string; mediaType: string; filename?: string }
    > = []
    if (text.trim()) parts.push({ type: "text", text })
    if (images) {
      for (const im of images) {
        const image = im.dataUrl ?? (im.ref ? await loadImageDataUrl(im.ref, im.mime) : "")
        if (image) parts.push({ type: "image", image, mediaType: im.mime || undefined })
      }
    }
    if (pdfs) {
      for (const p of pdfs) {
        if (pdfNative) {
          const data = await loadPdfDataUrl(p.ref)
          if (data) parts.push({ type: "file", data, mediaType: p.mime, filename: p.name })
        } else {
          let extracted = ""
          try {
            extracted = await extractPdfText(await loadPdfBytes(p.ref))
          } catch (e) {
            console.warn("[pdf] extract failed:", p.name, e)
          }
          const safeName = p.name.replace(/["<>]/g, "")
          const safeText = extracted.replace(/<\/pdf>/gi, "<\\/pdf>")
          const body = safeText
            ? `<pdf name="${safeName}">\n${safeText}\n</pdf>`
            : `<pdf name="${safeName}">(metin çıkarılamadı — taranmış olabilir)</pdf>`
          parts.push({ type: "text", text: body })
        }
      }
    }
    return parts
  }

  // Drop assistant turns whose content is empty (no text and no tool calls).
  // OpenAI tolerates them silently, but stricter providers (Kimi, Moonshot,
  // some OpenRouter routes) reject with "the message at position N with role
  // 'assistant' must not be empty". This can happen when a tool-only turn
  // produces no text and the tool result is the next message.
  function sanitizeHistoryForProvider(history: ModelMessage[]): ModelMessage[] {
    return history.filter((m) => {
      if (m.role !== "assistant") return true
      const c = m.content
      if (typeof c === "string") return c.trim().length > 0
      if (Array.isArray(c)) {
        // Keep when ANY part has substance: text with non-empty string, or
        // any tool-call / file / image part.
        return c.some((p) => {
          if (!p || typeof p !== "object") return false
          if (p.type === "text") {
            return typeof p.text === "string" && p.text.trim().length > 0
          }
          // tool-call, file, image, reasoning, etc. — non-empty signal.
          return true
        })
      }
      return false
    })
  }

  function onAbortFor(sid: string) {
    if (!sid) return
    abortStream(sid)
    void useJobsStore.getState().killBySession(sid)
    // M3: do NOT clear streamingIds here — the dying stream's own finally does
    // that. Clearing early lets a queued/new run start, and the dying stream's
    // late finally then wipes the NEW run's streaming flag (single-flight lost).
    const msgs = useSessionsStore.getState().sessions[sid]?.messages
    const last = msgs?.[msgs.length - 1]
    if (last && last.role === "assistant" && last.pending) {
      useSessionsStore.getState().patchMessageFor(sid, last.id, { pending: false, endedAt: Date.now() })
    }
  }

  function onAbort() {
    const aid = useSessionsStore.getState().activeId
    if (aid) onAbortFor(aid)
  }

  const contextPanelOpen =
    !showSettings && !showRoutines && panelMode !== null && panelMode !== "terminal"

  const workspaceTabsOpen = panelMode === "files" || panelMode === "git" || panelMode === "review"
  const editorFile = activeFile
  const turnDiffOpen = !!editorFile && isTurnDiffUri(editorFile)
  const editorPaneOpen = editorFile !== null
  const chatPaneOpen = editorFile === null
  const sidebarCollapsed = sidebarHidden

  const sideChat = sideChatOpen && activeSessionId ? (
    <SideChatPanel
      sessionId={activeSessionId}
      threadId={sideChatThreadId}
      busy={sideChatBusy}
      onAsk={(q) => openSideChat(q)}
      onStop={() => sideChatAbortRef.current?.abort()}
      onNewThread={newSideChatThreadAction}
      onSelectThread={(id) => setSideChatThreadId(id)}
      onClose={() => setSideChatOpen(false)}
    />
  ) : null

  const editorContent = useMemo(
    () =>
      editorFile ? (
        isDiffUri(editorFile) ? (
          <DiffViewer uri={editorFile} />
        ) : isTurnDiffUri(editorFile) ? (
          <TurnDiffViewer uri={editorFile} />
        ) : isOutputUri(editorFile) ? (
          <OutputViewer uri={editorFile} />
        ) : isPrUri(editorFile) ? (
          <PRConversationViewer uri={editorFile} />
        ) : isTerminalUri(editorFile) ? (
          <Suspense fallback={null}>
            <TerminalPanel
              workspacePath={workspacePath}
              terminalId={parseTerminalUri(editorFile) ?? undefined}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <FileViewer path={editorFile} />
          </Suspense>
        )
      ) : null,
    [editorFile, workspacePath],
  )

  const chatPane = (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          streaming={activeStreaming}
          onScrolledChange={setChatScrolled}
          searchOpen={showChatSearch}
          onCloseSearch={() => setShowChatSearch(false)}
          onRegenerate={onRegenerate}
          onEditUser={onEditUser}
          onBranch={onBranch}
          onRevert={(id) => void onRevert(id)}
          onReview={(id, path) => openFile(makeTurnDiffUri(id, path), { preview: true })}
          onOpenAgentPanel={() => {}}
          onAskSideChat={(question) => openSideChat(question)}
          onAskSplitChat={(question) => void askSelectionInSplit(question)}
          onContinue={() => void onSend(tStatic("messageList.continueAction"))}
          onQuickPrompt={(prompt) => void onSend(prompt)}
        />
      </div>

      <div className="relative">
        {error && error.sid === activeSessionId && (
          <div className="absolute inset-x-0 bottom-full z-20">
            <div className="mx-auto w-full max-w-[860px] px-6">
              <ErrorBanner
                message={error.message}
                onDismiss={() => clearError()}
                onOpenSettings={
                  isAuthErrorMessage(error.message)
                    ? () => {
                        clearError()
                        setShowSettings(true)
                      }
                    : undefined
                }
              />
            </div>
          </div>
        )}
        <QuestionModal />
        {activeIsWorker ? (
          <div className="flex items-center justify-between gap-3 border-t border-codezal-hair bg-codezal-sidebar px-4 py-3">
            <span className="min-w-0 truncate text-sm text-codezal-mute">
              {tStatic("composer.workerNoSend")}
            </span>
            <button
              type="button"
              onClick={() => {
                if (activeWorkerOwnerId) void useSessionsStore.getState().open(activeWorkerOwnerId)
              }}
              className="shrink-0 rounded-md border border-codezal bg-codezal-chip/40 px-3 py-1.5 text-sm font-medium text-codezal-accent transition-colors hover:bg-codezal-chip"
            >
              {tStatic("composer.returnToParent")}
            </button>
          </div>
        ) : (
          <Composer
            streaming={activeStreaming}
            compacting={activeCompacting}
            onSend={onSend}
            onAbort={onAbort}
            onSlashAction={(a, args) => void onSlashAction(a, args)}
            onRemember={(txt, scope) => void onRemember(txt, scope)}
            queued={queuedActive}
            onQueue={(txt) => {
              const sid = useSessionsStore.getState().activeId
              if (sid) enqueueMessage(sid, txt)
            }}
            onUnqueue={(i) => {
              const sid = useSessionsStore.getState().activeId
              if (sid) removeQueuedAt(sid, i)
            }}
          />
        )}
      </div>
    </>
  )

  const tabBarEl = (
    <TabBar
      panelMode={panelMode}
      onSetPanelMode={handlePanelModeChange}
      workspaceTabsOpen={workspaceTabsOpen && openFilesCount > 0}
      sidebarHidden={sidebarCollapsed}
      scrolled={!activeEmpty && chatScrolled}
      onExpandSidebar={() => setSidebarHidden(false)}
      onOpenSearch={() => setShowSearch(true)}
      onOpenSettings={() => setShowSettings(true)}
      onNewSession={() => void openNewSession(false)}
      onOpenFork={() => setShowForkDialog(true)}
      onNewProject={() => void onNewProject()}
      splitActive={!!splitId}
      onToggleSplit={() => void toggleSplit()}
      sideChatActive={sideChatOpen}
      onToggleSideChat={() => (sideChatOpen ? setSideChatOpen(false) : openSideChat())}
      canNavBack={navCan.back}
      canNavForward={navCan.forward}
      onNavBack={navBack}
      onNavForward={navForward}
    />
  )

  return (
    <ErrorBoundary>
    <div className="cz-app-shell flex h-full overflow-hidden bg-codezal-sidebar text-codezal-text">
      <a
        href="#ana-icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-codezal-accent focus:px-3 focus:py-2 focus:text-accent-foreground"
      >
        {tStatic("a11y.skipToContent")}
      </a>
      <Toaster />
      <MascotOverlay hidden={showSettings || showRoutines || showHelp} />
      {settingsLoaded && !settings.onboardingCompleted && (
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
      )}
      {!sidebarCollapsed && !showSettings && (
        <Sidebar
          onOpenSettings={() => {
            setSettingsTab(undefined)
            setShowRoutines(false)
            setShowSettings((v) => !v)
          }}
          onOpenRoutines={() => {
            setShowSettings(false)
            setShowRoutines(true)
          }}
          onOpenSession={() => {
            setShowSettings(false)
            setShowRoutines(false)
          }}
          onCollapse={() => setSidebarHidden(true)}
          onOpenSearch={() => setShowSearch(true)}
          onNewProject={() => void onNewProject()}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-codezal-panel bg-codezal-bg">
        {showSettings ? (
          <Suspense fallback={null}>
            <SettingsPage
              onClose={() => {
                setShowSettings(false)
                setSettingsTab(undefined)
              }}
              reserveTrafficLights={sidebarCollapsed || showSettings}
              initialTab={settingsTab}
            />
          </Suspense>
        ) : showRoutines ? (
          <Suspense fallback={null}>
            <AutopilotPage
              onClose={() => setShowRoutines(false)}
              onRun={async (prompt, opts) => {
                const provider = (opts?.provider as ProviderId | undefined) ?? settings.defaultProvider
                const model = opts?.model ?? settings.defaultModel
                await create(provider, model, settings.defaultWorkspacePath)
                void onSend(prompt)
              }}
            />
          </Suspense>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {tabBarEl}

              <div className="flex min-h-0 flex-1">
              <main
                id="ana-icerik"
                className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                <div className="flex min-h-0 flex-1">
                  {chatPaneOpen && (
                    <aside
                      className="relative flex min-w-0 flex-1 flex-col"
                    >
                      {chatPane}
                      {sideChat}
                    </aside>
                  )}

                  {editorPaneOpen && (
                    <section
                      className={cn(
                        "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-codezal-bg",
                        turnDiffOpen && "animate-turn-diff-in",
                      )}
                    >
                      {editorContent ?? (
                        <div className="flex min-h-0 flex-1 flex-col bg-codezal-code">
                          <div className="flex h-9 shrink-0 items-center border-b border-codezal-panel px-3 text-sm text-codezal-dim">
                            {tStatic("common.untitled")}-1
                          </div>
                          <div className="flex min-h-0 flex-1 pt-2 font-mono text-sm">
                            <div className="w-12 shrink-0 select-none pr-3 text-right text-codezal-mute/60">1</div>
                            <div className="h-[1.65rem] flex-1 bg-codezal-panel/20" />
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </main>

              {sessionDragActive && !splitId && !agentPaneId && (
                <div
                  ref={openZoneRef}
                  className="flex w-[42%] min-w-0 shrink-0 flex-col items-center justify-center gap-2 border-l border-dashed border-codezal-accent/60 bg-codezal-accent/5 text-codezal-accent"
                >
                  <Columns2 className="h-7 w-7" />
                  <span className="text-sm font-medium">{tStatic("split.dropToOpen")}</span>
                </div>
              )}

              {splitId && (
                <div
                  ref={splitPaneRef}
                  className={cn(
                    "relative flex min-w-0 flex-1 flex-col overflow-hidden border-l border-codezal-panel",
                    sessionDragActive && "ring-2 ring-inset ring-codezal-accent",
                  )}
                >
                  {sessionDragActive && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-codezal-accent/10 text-sm font-medium text-codezal-accent">
                      {tStatic("split.dropToSwap")}
                    </div>
                  )}
                  <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-codezal-panel bg-codezal-sidebar px-3">
                    <Columns2 className="h-4 w-4 shrink-0 text-codezal-accent" />
                    <Select
                      value={splitId}
                      onChange={(id) => {
                        void loadIntoPool(id).catch(() => {})
                        changeSplit(id)
                      }}
                      options={
                        splitId && !sessionIndex.some((m) => m.id === splitId)
                          ? [
                              { value: splitId, label: splitTitle ?? tStatic("commandPalette.newChat") },
                              ...sessionIndex.map((m) => ({ value: m.id, label: m.title })),
                            ]
                          : sessionIndex.map((m) => ({ value: m.id, label: m.title }))
                      }
                      compact
                      wrapperClassName="min-w-0 flex-1"
                      triggerClassName="w-full justify-between"
                    />
                    <button
                      type="button"
                      onClick={() => changeSplit(null)}
                      title={tStatic("tabBar.splitViewClose")}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="relative flex min-h-0 flex-1 flex-col">
                      <MessageList sessionId={splitId} streaming={splitStreaming} />
                    </div>
                    <div
                      className={cn(
                        "relative",
                        splitEmpty &&
                          "mx-auto w-full max-w-[820px] shrink-0 pb-[clamp(2rem,6vh,4.5rem)]",
                      )}
                    >
                      <Composer
                        sessionId={splitId}
                        streaming={splitStreaming}
                        compacting={splitCompacting}
                        onSend={onSendSplit}
                        onAbort={() => onAbortFor(splitId)}
                        queued={queuedSplit}
                        onQueue={(txt) => enqueueMessage(splitId, txt)}
                        onUnqueue={(i) => removeQueuedAt(splitId, i)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {agentPaneId && (
                <AgentTranscriptPane
                  workerId={agentPaneId}
                  onClose={() => setAgentPane(activeSessionId, null)}
                />
              )}

            </div>
          </div>

          {contextPanelOpen && (
            <ContextPanel
              mode={panelMode}
              onModeChange={setPanelMode}
              onClose={() => setPanelMode(null)}
              onSend={onSend}
              onOpenPreview={onOpenSddPreview}
              onBuild={onBuildSdd}
            />
          )}
        </div>
      )}
      </div>

      {showPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            open={showPalette}
            initialPage={palettePage}
            onClose={() => {
              setShowPalette(false)
              setPalettePage("root")
            }}
            onOpenSettings={() => setShowSettings(true)}
            onOpenSearch={() => {
              setShowPalette(false)
              setShowSearch(true)
            }}
            onOpenFork={() => {
              setShowPalette(false)
              setShowForkDialog(true)
            }}
          />
        </Suspense>
      )}

      {showForkDialog && (
        <Suspense fallback={null}>
          <ForkDialog open={showForkDialog} onClose={() => setShowForkDialog(false)} />
        </Suspense>
      )}

      {showSearch && (
        <Suspense fallback={null}>
          <SearchOverlay open={showSearch} onClose={() => setShowSearch(false)} />
        </Suspense>
      )}

      {showHelp && (
        <Suspense fallback={null}>
          <HelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
        </Suspense>
      )}

      <ApprovalModal />
      <UpdateToast />
    </div>
    </ErrorBoundary>
  )
}
