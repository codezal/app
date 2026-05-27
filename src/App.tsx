// Codezal Klasik shell: sol Sidebar, orta (TitleStrip + chat + Composer), sağ ContextPanel.
// macOS pencere hissi index.css'teki .lum-frame ve bg renkleriyle sağlanır.
import { useEffect, useRef, useState } from "react"
import { streamText, stepCountIs, type ModelMessage } from "ai"
import { Sidebar } from "@/components/Sidebar"
import { TabBar, type PanelMode } from "@/components/TabBar"
import { MessageList } from "@/components/MessageList"
import { Composer } from "@/components/Composer"
import { ContextPanel } from "@/components/ContextPanel"
import { FileViewer } from "@/components/FileViewer"
import { SettingsModal } from "@/components/SettingsDrawer"
import { StatusBar } from "@/components/StatusBar"
import { CommandPalette } from "@/components/CommandPalette"
import { SearchOverlay } from "@/components/SearchOverlay"
import { ApprovalModal } from "@/components/ApprovalModal"
import { QuestionModal } from "@/components/QuestionModal"
import { RoutinesOverlay } from "@/components/RoutinesOverlay"
import { OrchestraConfigModal } from "@/components/OrchestraConfigModal"
import type { ProviderId } from "@/lib/providers"
import { buildModel } from "@/lib/providers"
import { buildAllTools } from "@/lib/tools"
import { buildSystemPrompt } from "@/lib/system-prompt"
import { costUsd } from "@/lib/pricing"
import { shouldCompact, compactMessages, targetTokensAfterCompact } from "@/lib/compact"
import { estimateMessagesTokens } from "@/lib/tokens"
import { applyTheme, watchSystemTheme, applyFontScale } from "@/lib/theme"
import { runHooks } from "@/lib/hooks"
import {
  startScheduler,
  stopScheduler,
  refreshScheduler,
} from "@/lib/routine-scheduler"
import type { Routine } from "@/lib/routines"
import { replaySession } from "@/lib/replay"
import { makeToolCallRepair } from "@/lib/tool-repair"
import { pickWorkspaceFolder } from "@/lib/workspace"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import type { Message, Part } from "@/store/types"

export default function App() {
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const settings = useSettingsStore((s) => s.settings)
  const loadSettings = useSettingsStore((s) => s.load)

  const sessionsLoaded = useSessionsStore((s) => s.loaded)
  const active = useSessionsStore((s) => s.active)
  const activeId = useSessionsStore((s) => s.activeId)
  const loadAll = useSessionsStore((s) => s.loadAll)
  const create = useSessionsStore((s) => s.create)
  const pushMessage = useSessionsStore((s) => s.pushMessage)
  const patchMessage = useSessionsStore((s) => s.patchMessage)
  const appendModelMessages = useSessionsStore((s) => s.appendModelMessages)
  const replaceModelMessages = useSessionsStore((s) => s.replaceModelMessages)
  const setEffectiveContextTokens = useSessionsStore((s) => s.setEffectiveContextTokens)
  const addUsage = useSessionsStore((s) => s.addUsage)
  const persistActive = useSessionsStore((s) => s.persistActive)
  const editMessage = useSessionsStore((s) => s.editMessage)
  const truncateAfter = useSessionsStore((s) => s.truncateAfter)
  const deleteMessage = useSessionsStore((s) => s.deleteMessage)
  const forkAt = useSessionsStore((s) => s.forkAt)
  const clearMessages = useSessionsStore((s) => s.clearMessages)
  const revertToBeforeMessage = useSessionsStore((s) => s.revertToBeforeMessage)

  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [showOrchestra, setShowOrchestra] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Scheduler fire callback'i mevcut state'i okumalı — useEffect closure'lardan kaçınmak için ref.
  const runRoutineRef = useRef<(r: Routine) => Promise<void>>(async () => {})

  // Replay durumu — overlay göster, ilerleme bildir, iptal.
  const [replayState, setReplayState] = useState<{
    running: boolean
    current: number
    total: number
    prompt: string
    abort?: () => void
  }>({ running: false, current: 0, total: 0, prompt: "" })

  // Streaming bayrağı poll edilerek bir send'in bitmesini bekle.
  const streamingRef = useRef(streaming)
  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])
  async function waitUntilIdle(signal: AbortSignal): Promise<void> {
    // İlk dispatch'in streaming=true'ya gelmesi için kısa bekleme
    await new Promise((r) => setTimeout(r, 50))
    while (streamingRef.current) {
      if (signal.aborted) return
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  async function onReplay(sessionId: string): Promise<void> {
    if (replayState.running) return
    const ac = new AbortController()
    setReplayState({ running: true, current: 0, total: 0, prompt: "", abort: () => ac.abort() })
    try {
      const result = await replaySession(sessionId, {
        signal: ac.signal,
        onProgress: (current, total, prompt) =>
          setReplayState((s) => ({ ...s, current, total, prompt })),
        newSession: async (provider, model, workspace) => {
          await create(provider as ProviderId, model, workspace)
          // Active state'in yansıması için bir tick bekle
          await new Promise((r) => setTimeout(r, 30))
        },
        sendAndWait: async (prompt) => {
          await onSend(prompt)
          await waitUntilIdle(ac.signal)
        },
      })
      if (result.aborted) {
        setError(`Replay iptal edildi (${result.replayed}/${result.total} tamamlandı)`)
      }
    } catch (e) {
      setError(`Replay hatası: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setReplayState({ running: false, current: 0, total: 0, prompt: "" })
    }
  }

  // İlk açılış: store'ları yükle
  useEffect(() => {
    void loadSettings()
    void loadAll()
  }, [loadSettings, loadAll])

  // Scheduler — uygulama açıkken cron alanı dolu rutinleri tetikler.
  // Fire = yeni session aç, routine prompt'unu gönder.
  useEffect(() => {
    runRoutineRef.current = async (r: Routine) => {
      try {
        const provider = (r.provider as ProviderId | undefined) ?? settings.defaultProvider
        const model = r.model ?? settings.defaultModel
        await create(provider, model, settings.defaultWorkspacePath)
        // create state'i atomik günceller; bir tick sonra onSend
        setTimeout(() => void onSend(r.prompt), 30)
      } catch (e) {
        console.warn(`[scheduler] '${r.name}' fire başarısız:`, e)
      }
    }
  })

  useEffect(() => {
    if (!settingsLoaded) return
    void startScheduler({
      workspacePath: active?.workspacePath,
      onFire: (r) => runRoutineRef.current(r),
    })
    return () => stopScheduler()
  }, [settingsLoaded])

  // Workspace değişti → rutin listesini yenile
  useEffect(() => {
    if (!settingsLoaded) return
    void refreshScheduler(active?.workspacePath)
  }, [active?.workspacePath, settingsLoaded])

  // Tema uygula + system değişimini takip
  useEffect(() => {
    applyTheme(settings.theme)
    if (settings.theme !== "system") return
    return watchSystemTheme(() => applyTheme("system"))
  }, [settings.theme])

  // Yazı ölçeği uygula — Tauri webview setZoom (browser-level, viewport-aware)
  useEffect(() => {
    void applyFontScale(settings.fontScale)
  }, [settings.fontScale])

  // API anahtarı yoksa settings aç
  useEffect(() => {
    if (settingsLoaded && Object.keys(settings.apiKeys).length === 0) {
      setShowSettings(true)
    }
  }, [settingsLoaded, settings.apiKeys])

  // Hiç session yoksa otomatik oluştur
  useEffect(() => {
    if (sessionsLoaded && !activeId && useSessionsStore.getState().index.length === 0) {
      void create(
        settings.defaultProvider,
        settings.defaultModel,
        settings.defaultWorkspacePath,
      )
    }
  }, [sessionsLoaded, activeId, create, settings])

  // Kısayollar: ⌘N yeni · ⌘K palet · ⌘, ayarlar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === "n") {
        e.preventDefault()
        // ⌘N: klasörsüz başla
        void create(settings.defaultProvider, settings.defaultModel, undefined)
      } else if (e.key === "k") {
        e.preventDefault()
        setShowPalette((v) => !v)
      } else if (e.key === ",") {
        e.preventDefault()
        setShowSettings((v) => !v)
      } else if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault()
        setShowSearch((v) => !v)
      } else if (e.key === "b") {
        e.preventDefault()
        setPanelMode((m) => (m ? null : "files"))
      } else if (e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault()
        setPanelMode((m) => (m === "terminal" ? null : "terminal"))
      } else if (e.key === "m" || e.key === "M") {
        // Plan/Build mode toggle
        e.preventDefault()
        const cur = useSessionsStore.getState().active
        if (!cur) return
        const next = (cur.mode ?? "build") === "build" ? "plan" : "build"
        useSessionsStore.getState().setMode(next)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [create, settings])

  // Otomatik bağlam sıkıştırma. Send öncesi çağrılır.
  // Hysteresis: trigger %90 → target %40 (settings.autoCompact'tan).
  async function runCompaction(): Promise<boolean> {
    const snap = useSessionsStore.getState().active
    if (!snap) return false
    const msgs = snap.modelMessages ?? []
    if (msgs.length < 4) return false

    const eff = estimateMessagesTokens(msgs)
    if (!shouldCompact(eff, snap.model, settings.autoCompact)) {
      return false
    }

    try {
      const { messages: compacted } = await compactMessages({
        messages: msgs,
        apiKeys: settings.apiKeys,
        activeProvider: snap.provider,
        activeModel: snap.model,
        settings: settings.autoCompact,
      })

      // Hedef boyutun altına inmediysek (compaction yeterli olmadıysa) uyar — yine de yaz.
      const newEff = estimateMessagesTokens(compacted)
      const target = targetTokensAfterCompact(snap.model, settings.autoCompact)
      if (newEff > target) {
        console.warn(
          `[compact] hedef altı: ${newEff} > ${target} — keepLast=${settings.autoCompact.keepLast} azaltılabilir`,
        )
      }

      replaceModelMessages(compacted)
      setEffectiveContextTokens(newEff)
      return true
    } catch (e) {
      console.error("[compact] başarısız:", e)
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Sıkıştırma başarısız: ${msg}`)
      return false
    }
  }

  async function onSend(text: string) {
    if (!active) return
    setError(null)

    // UserPromptSubmit hook'ları — stdout ile prompt'a ek bağlam injekte edilebilir.
    let effectiveText = text
    try {
      const hookRes = await runHooks({
        hooks: settings.hooks,
        event: "UserPromptSubmit",
        payload: { prompt: text },
        workspace: active.workspacePath,
      })
      if (hookRes.extraContext) {
        effectiveText = `${text}\n\n<hook-context>\n${hookRes.extraContext}\n</hook-context>`
      }
    } catch (e) {
      console.warn("[hook] UserPromptSubmit error:", e)
    }

    // Send öncesi otomatik sıkıştırma kontrolü
    if (settings.autoCompact.enabled) {
      await runCompaction()
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    }
    const asstMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      parts: [],
      createdAt: Date.now(),
      pending: true,
    }
    pushMessage(userMsg)
    pushMessage(asstMsg)

    // Geçmiş: önceki modelMessages varsa onu kullan, yoksa text-only fallback
    // (sıkıştırma yapıldıysa store güncellenmiştir — taze snap çek)
    const snap = useSessionsStore.getState().active!
    const prior: ModelMessage[] = snap.modelMessages ?? messagesToModelFallback(snap.messages)
    const history: ModelMessage[] = [...prior, { role: "user", content: effectiveText }]

    await runStream(asstMsg.id, history)
  }

  // Aktif son user mesajından itibaren yeniden cevap üret.
  // userMsgId: tutulacak son user mesajının id'si. Bundan sonraki her şey silinir,
  // yeni asistan mesajı eklenir ve stream baştan başlar.
  async function onRegenerate(userMsgId: string) {
    if (!active) return
    setError(null)
    // userMsgId dahil her şeye kadar kes
    truncateAfter(userMsgId)
    // En güncel state'i al
    const snap = useSessionsStore.getState().active
    if (!snap) return
    const asstMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      parts: [],
      createdAt: Date.now(),
      pending: true,
    }
    pushMessage(asstMsg)
    // Geçmiş: truncate sonrası modelMessages veya text fallback
    const history: ModelMessage[] =
      snap.modelMessages ?? messagesToModelFallback(snap.messages)
    await runStream(asstMsg.id, history)
  }

  // User mesajı içeriği güncelle, sonrasını sil, yeniden çalıştır.
  function onEditUser(userMsgId: string, newText: string) {
    editMessage(userMsgId, newText)
    void onRegenerate(userMsgId)
  }

  // Bu mesajdan çatal (yeni session) kur, aktif yap.
  async function onBranch(messageId: string) {
    try {
      await forkAt(messageId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  function onDeleteMessage(id: string) {
    deleteMessage(id)
  }

  async function onRevert(messageId: string) {
    if (!window.confirm("Bu mesajın yaptığı dosya değişiklikleri geri alınacak ve mesaj silinecek. Devam et?")) {
      return
    }
    try {
      const r = await revertToBeforeMessage(messageId)
      console.info(`[revert] ${r.restored} dosya restore, ${r.deleted} silindi`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Revert başarısız: ${msg}`)
    }
  }

  // Composer slash komut aksiyonu — built-in eylemleri buradan dispatch.
  async function onSlashAction(action: string, args: string) {
    switch (action) {
      case "clear":
        clearMessages()
        return
      case "branch": {
        const last = active?.messages[active.messages.length - 1]
        if (last) await onBranch(last.id)
        return
      }
      case "model":
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
        setShowSettings(true)
        return
      case "stop":
        abortRef.current?.abort()
        return
      case "agent": {
        // /agent NAME görev… → spawn_agent çağrı talimatı
        const sp = args.indexOf(" ")
        const name = sp === -1 ? args : args.slice(0, sp)
        const task = sp === -1 ? "" : args.slice(sp + 1).trim()
        if (!name) {
          setError("/agent <name> [görev] — agent adı gerekli")
          return
        }
        const text = task
          ? `\`spawn_agent\` ile **${name}** ajanını çağır ve şu görevi ver:\n\n${task}`
          : `\`spawn_agent\` ile **${name}** ajanını çağır.`
        void onSend(text)
        return
      }
      case "skill": {
        const sp = args.indexOf(" ")
        const name = sp === -1 ? args : args.slice(0, sp)
        const rest = sp === -1 ? "" : args.slice(sp + 1).trim()
        if (!name) {
          setError("/skill <name> [görev] — skill adı gerekli")
          return
        }
        const text = rest
          ? `\`load_skill('${name}')\` ile skill'i yükle, sonra şu görev:\n\n${rest}`
          : `\`load_skill('${name}')\` ile yükle ve özet ver.`
        void onSend(text)
        return
      }
      case "help":
        void onSend(
          "Slash komutları: `/clear /branch /model /agent <ad> [görev] /skill <ad> [görev] /workspace /search /routines /settings /stop /help`. Kullanıcı tanımlı komutlar `.codezal/commands/<ad>.md` ile eklenir.",
        )
        return
    }
  }

  async function runStream(asstMsgId: string, history: ModelMessage[]) {
    if (!active) return
    const ac = new AbortController()
    abortRef.current = ac
    setStreaming(true)
    try {
      const model = buildModel(active.provider, active.model, settings.apiKeys)
      const tools = await buildAllTools(active.workspacePath, settings.mcpServers ?? [])
      const system = await buildSystemPrompt({
        workspacePath: active.workspacePath,
        modelLabel: `${active.provider}/${active.model}`,
        mode: active.mode ?? "build",
        orchestra: active.orchestra,
      })
      const result = streamText({
        model,
        system,
        messages: history,
        tools,
        // 20 → 80 — büyük agentic görevler 20 adımı kolay aşıyor, akış yarıda kalıyordu.
        stopWhen: stepCountIs(80),
        abortSignal: ac.signal,
        // Tool-call repair: NoSuchToolError (fuzzy match) + InvalidToolInputError (JSON yamalama).
        experimental_repairToolCall: makeToolCallRepair(),
        onError: ({ error }) => {
          // Yarıda kalma debug için
          console.error("[streamText] error:", error)
        },
      })

      // Stream UI: text-delta + reasoning + tool-call + tool-result chunk'larını parts'a yaz
      const parts: Part[] = []
      let textBuf = ""
      let reasoningBuf = ""
      const flushText = () => {
        if (!textBuf) return
        parts.push({ type: "text", text: textBuf })
        textBuf = ""
      }
      const flushReasoning = () => {
        if (!reasoningBuf) return
        parts.push({ type: "reasoning", text: reasoningBuf })
        reasoningBuf = ""
      }

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case "text-delta":
            flushReasoning()
            textBuf += chunk.text ?? ""
            patchMessage(asstMsgId, {
              parts: [...parts, { type: "text", text: textBuf }],
              content: collapseText([...parts, { type: "text", text: textBuf }]),
            })
            break
          case "reasoning-delta": {
            flushText()
            const delta = (chunk as { text?: string }).text ?? ""
            reasoningBuf += delta
            patchMessage(asstMsgId, {
              parts: [...parts, { type: "reasoning", text: reasoningBuf }],
              content: collapseText([...parts, { type: "reasoning", text: reasoningBuf }]),
            })
            break
          }
          case "tool-call":
            flushText()
            flushReasoning()
            parts.push({
              type: "tool-call",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: chunk.input,
            })
            patchMessage(asstMsgId, { parts: [...parts], content: collapseText(parts) })
            break
          case "tool-result":
            parts.push({
              type: "tool-result",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              output: stringifyToolOutput(chunk.output),
            })
            patchMessage(asstMsgId, { parts: [...parts], content: collapseText(parts) })
            break
          case "error": {
            const err = chunk.error
            const msg = err instanceof Error ? err.message : String(err)
            console.error("[stream chunk error]", err)
            throw new Error(msg)
          }
          case "finish": {
            const reason = (chunk as { finishReason?: string }).finishReason
            if (reason && reason !== "stop" && reason !== "tool-calls") {
              console.warn("[stream finish]", reason)
            }
            break
          }
        }
      }
      flushText()
      flushReasoning()
      patchMessage(asstMsgId, {
        parts: [...parts],
        content: collapseText(parts),
        pending: false,
      })

      // Final ModelMessage geçmişini kaydet (sonraki tur için sağlam yapı)
      const resp = await result.response
      appendModelMessages(resp.messages)

      // Yeni modelMessages üzerinden efektif bağlam tahminini güncelle
      const updatedSnap = useSessionsStore.getState().active
      const effectiveTokens = updatedSnap
        ? estimateMessagesTokens(updatedSnap.modelMessages ?? [], system)
        : 0

      // Usage + cost ekle
      try {
        const usage = await result.usage
        if (usage) {
          const input = usage.inputTokens ?? 0
          const output = usage.outputTokens ?? 0
          const cacheRead =
            (usage as { cachedInputTokens?: number }).cachedInputTokens ??
            (usage as { promptCacheHitTokens?: number }).promptCacheHitTokens ??
            0
          const reasoning =
            (usage as { reasoningTokens?: number }).reasoningTokens ?? 0
          addUsage({
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            reasoningTokens: reasoning,
            costUsd: costUsd(active.model, {
              input,
              output,
              cacheRead,
            }),
            // Overwrite: son turn input + efektif bağlam
            lastInputTokens: input,
            effectiveContextTokens: effectiveTokens,
          })
        } else {
          // Usage gelmediyse en azından efektif bağlamı set et
          setEffectiveContextTokens(effectiveTokens)
        }
      } catch {
        // usage erişilemezse sessiz geç — yine de efektif bağlamı yaz
        setEffectiveContextTokens(effectiveTokens)
      }

      await persistActive()
    } catch (e) {
      if (ac.signal.aborted) {
        patchMessage(asstMsgId, { pending: false })
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        patchMessage(asstMsgId, { pending: false })
      }
    } finally {
      setStreaming(false)
      const aborted = abortRef.current?.signal.aborted ?? false
      abortRef.current = null
      // Stop hook — tur bitince (success/abort/error). Çıktı yok sayılır.
      try {
        await runHooks({
          hooks: settings.hooks,
          event: "Stop",
          payload: { reason: aborted ? "abort" : "finish" },
          workspace: active?.workspacePath,
        })
      } catch (e) {
        console.warn("[hook] Stop error:", e)
      }
    }
  }

  // Tool çıktısını okunabilir metne çevir (AI SDK output şekli {type, value} olabilir)
  function stringifyToolOutput(out: unknown): string {
    if (typeof out === "string") return out
    if (out && typeof out === "object" && "value" in out) {
      const v = (out as { value: unknown }).value
      return typeof v === "string" ? v : JSON.stringify(v, null, 2)
    }
    return JSON.stringify(out, null, 2)
  }

  // parts'tan sadece text'leri birleştir — fallback display & search için
  function collapseText(parts: Part[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n")
  }

  // Tool öncesi eski sessionlar için: düz user/assistant text → ModelMessage
  function messagesToModelFallback(msgs: Message[]): ModelMessage[] {
    return msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  }

  function onAbort() {
    abortRef.current?.abort()
  }

  const activeFile = active?.activeFile ?? null

  return (
    <div className="flex h-screen overflow-hidden bg-codezal-bg text-codezal-text">
      <Sidebar
        onOpenSettings={() => setShowSettings((v) => !v)}
        onOpenRoutines={() => setShowRoutines(true)}
        onReplay={onReplay}
      />
      {replayState.running && (
        <div className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-md border border-codezal bg-codezal-panel/95 px-3 py-1.5 text-[11.5px] text-codezal-text shadow-lg">
          Replay {replayState.current}/{replayState.total}: {replayState.prompt.slice(0, 60)}
          {replayState.prompt.length > 60 && "…"}
          <button
            type="button"
            onClick={() => replayState.abort?.()}
            className="ml-2 rounded border border-codezal px-1.5 py-0.5 text-[10.5px] text-codezal-dim hover:text-destructive"
          >
            iptal
          </button>
        </div>
      )}

      {/* Sağ sütun — üstte tam genişlik TabBar, altta main + ContextPanel */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar panelMode={panelMode} onSetPanelMode={setPanelMode} />

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            {activeFile ? (
              <FileViewer path={activeFile} />
            ) : (
              <>
                <MessageList
                  messages={active?.messages ?? []}
                  streaming={streaming}
                  onRegenerate={onRegenerate}
                  onEditUser={onEditUser}
                  onBranch={onBranch}
                  onDelete={onDeleteMessage}
                  onRevert={(id) => void onRevert(id)}
                />

                {error && (
                  <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
                    {error}
                  </div>
                )}

                <Composer
                  streaming={streaming}
                  onSend={onSend}
                  onAbort={onAbort}
                  disabled={!active}
                  onSlashAction={(a, args) => void onSlashAction(a, args)}
                  onOpenOrchestra={() => setShowOrchestra(true)}
                />
              </>
            )}
          </main>

          {panelMode && (
            <ContextPanel mode={panelMode} onClose={() => setPanelMode(null)} />
          )}
        </div>

        <StatusBar />
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSearch={() => {
          setShowPalette(false)
          setShowSearch(true)
        }}
      />

      <SearchOverlay open={showSearch} onClose={() => setShowSearch(false)} />

      <RoutinesOverlay
        open={showRoutines}
        onClose={() => setShowRoutines(false)}
        onRun={async (prompt, opts) => {
          const provider = (opts?.provider as ProviderId | undefined) ?? settings.defaultProvider
          const model = opts?.model ?? settings.defaultModel
          await create(provider, model, settings.defaultWorkspacePath)
          // create state'i atomik güncelliyor; bir tick sonra onSend
          setTimeout(() => void onSend(prompt), 30)
        }}
      />

      {showOrchestra && (
        <OrchestraConfigModal onClose={() => setShowOrchestra(false)} />
      )}

      <ApprovalModal />
      <QuestionModal />
    </div>
  )
}
