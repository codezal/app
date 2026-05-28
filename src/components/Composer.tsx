// Composer — chip butonlar, workspace/branch/permission, model + effort, send.
// Codezal Klasik stili. Slash komutları inline picker ile.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Check,
  ChevronDown,
  Eye,
  Folder,
  FolderPlus,
  HandIcon,
  Music,
  Paperclip,
  Plus,
  Send,
} from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import type { ApprovalMode } from "@/store/types"
import {
  listProviderAdapters,
  modelsFor,
  defaultModelFor,
  isConnectedSync,
  type ProviderId,
} from "@/lib/providers"
import { modelDetail, type ProvidersCatalog } from "@/lib/providers-catalog"
import { contextCap } from "@/lib/pricing"
import { basename, pickWorkspaceFolder } from "@/lib/workspace"
import {
  listAllCommands,
  parseSlashInput,
  renderTemplate,
  type SlashCommand,
} from "@/lib/commands"
import { SlashMenu, filterCommands } from "./SlashMenu"
import { BranchPicker } from "./BranchPicker"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = {
  streaming: boolean
  onSend: (text: string) => void
  onAbort: () => void
  disabled?: boolean
  placeholder?: string
  // App tarafına devredilen built-in slash aksiyonları
  onSlashAction?: (action: NonNullable<SlashCommand["action"]>, args: string) => void
  // Composer "Orkestra modu" tıklanınca App üst seviyesinde modal aç
  onOpenOrchestra?: () => void
}

type Effort = "low" | "medium" | "high"

export function Composer({
  streaming,
  onSend,
  onAbort,
  disabled,
  placeholder,
  onSlashAction,
  onOpenOrchestra,
}: Props) {
  const t = useT()
  const [text, setText] = useState("")
  const [effort, setEffort] = useState<Effort>("high")
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const setMode = useSessionsStore((s) => s.setMode)
  // Dar selector'lar — Composer, stream sırasında active.messages her patch'te
  // değişse de re-render OLMAZ; yalnız bu primitive alanlar değişince uyanır.
  const hasActive = useSessionsStore((s) => s.active != null)
  const mode = useSessionsStore((s) => s.active?.mode ?? "build")
  const workspacePath = useSessionsStore((s) => s.active?.workspacePath)
  const provider = useSessionsStore((s) => s.active?.provider)
  const model = useSessionsStore((s) => s.active?.model)
  const msgCount = useSessionsStore((s) => s.active?.messages.length ?? 0)
  const effectiveTok = useSessionsStore((s) => s.active?.usage?.effectiveContextTokens)
  const lastInputTok = useSessionsStore((s) => s.active?.usage?.lastInputTokens)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const approvalMode = settings.approvalMode

  // Slash command kataloğu — workspace değişince + plugin register/unregister
  // event'inde (codezal:commands-changed) yenile.
  useEffect(() => {
    let alive = true
    function refresh() {
      void listAllCommands(workspacePath).then((cmds) => {
        if (alive) setCommands(cmds)
      })
    }
    refresh()
    window.addEventListener("codezal:commands-changed", refresh)
    return () => {
      alive = false
      window.removeEventListener("codezal:commands-changed", refresh)
    }
  }, [workspacePath])

  // Slash menüsü aktif mi? Sadece `/` ile başlayıp boşluk yoksa.
  const slashState = useMemo(() => {
    if (!text.startsWith("/")) return { open: false, query: "" }
    const sp = text.indexOf(" ")
    if (sp !== -1) return { open: false, query: "" }
    return { open: true, query: text.slice(1) }
  }, [text])

  // Filtreli listenin uzunluğu değişince seçim indeksini sıfırla
  const filteredCount = useMemo(
    () => filterCommands(commands, slashState.query).length,
    [commands, slashState.query],
  )
  useEffect(() => {
    setSlashIdx(0)
  }, [slashState.query, filteredCount])

  function pickSlash(cmd: SlashCommand) {
    // /cmd arg... varsa arg kısmını al; aksi takdirde boş
    const parsed = parseSlashInput(text) ?? { name: cmd.name, args: "" }
    const args = parsed.args
    // Built-in aksiyon
    if (cmd.scope === "builtin" && cmd.action) {
      onSlashAction?.(cmd.action, args)
      setText("")
      return
    }
    // User-defined template
    if (cmd.template !== undefined) {
      const rendered = renderTemplate(cmd.template, args).trim()
      if (!rendered) {
        setText("")
        return
      }
      onSend(rendered)
      setText("")
    }
  }

  async function pickWorkspace() {
    const path = await pickWorkspaceFolder()
    if (!path) return
    // Aktif session varsa bağla
    if (hasActive) updateActiveMeta({ workspacePath: path })
    // Varsayılan da güncellensin → lazy create / sonraki session aynı klasörle açılır
    void updateSettings({ defaultWorkspacePath: path })
  }

  useEffect(() => {
    ref.current?.focus()
    // HMR / önceki implementasyondan kalmış inline height varsa temizle
    ref.current?.style.removeProperty("height")
  }, [])

  // Satır sayısı — webview zoom altında scrollHeight ölçümü stale kaldığı için
  // JS height set yerine native `rows` attribute kullanıyoruz. Browser font-size +
  // zoom faktörünü kendi hesaplar; placeholder ve içerik her zaman doğru hizalanır.
  const rowCount = useMemo(() => {
    const lines = text.split("\n").length
    return Math.min(Math.max(lines, 1), 20)
  }, [text])

  function trySend() {
    const t = text.trim()
    if (!t || streaming || disabled) return
    // Slash komut?
    const slash = parseSlashInput(t)
    if (slash) {
      const cmd = commands.find((c) => c.name === slash.name)
      if (cmd) {
        if (cmd.scope === "builtin" && cmd.action) {
          onSlashAction?.(cmd.action, slash.args)
          setText("")
          return
        }
        if (cmd.template !== undefined) {
          const rendered = renderTemplate(cmd.template, slash.args).trim()
          if (!rendered) {
            setText("")
            return
          }
          onSend(rendered)
          setText("")
          return
        }
      }
      // Bilinmeyen slash → metni olduğu gibi yolla
    }
    setText("")
    onSend(t)
  }

  // Tek doğru kaynak: StatusBar ile aynı — efektif bağlam tahmini.
  // Usage henüz yoksa (ilk tur öncesi) 0; eski messages-bazlı tahmin kaldırıldı
  // (her stream frame'inde re-render tetikliyordu).
  const tokenCount = effectiveTok ?? lastInputTok ?? 0
  const effortLabel = effort === "high" ? t("composer.effortHigh") : effort === "medium" ? t("composer.effortMedium") : t("composer.effortLow")

  return (
    <footer className="border-t border-codezal bg-codezal-bg px-8 pb-4 pt-2.5">
      <div className="relative w-full">
        <SlashMenu
          open={slashState.open}
          query={slashState.query}
          commands={commands}
          selectedIndex={slashIdx}
          onSelectIndex={setSlashIdx}
          onPick={pickSlash}
        />
      <div className="relative rounded-xl border border-codezal bg-codezal-input">
        {/* Input alanı */}
        <div className="min-h-[56px] px-4 pb-2 pt-3.5">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Slash menü açıkken navigasyon onun
              if (slashState.open && filteredCount > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashIdx((i) => (i + 1) % filteredCount)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashIdx((i) => (i - 1 + filteredCount) % filteredCount)
                  return
                }
                if (e.key === "Tab" || e.key === "Enter") {
                  e.preventDefault()
                  const filtered = filterCommands(commands, slashState.query)
                  const pick = filtered[slashIdx]
                  if (pick) pickSlash(pick)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setText("")
                  return
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                trySend()
              }
            }}
            placeholder={placeholder ?? t("composer.defaultPlaceholder")}
            rows={rowCount}
            disabled={disabled}
            // height: auto inline — HMR/önceki versiyondan kalan stale height override edilsin
            style={{ height: "auto" }}
            className="block w-full resize-none overflow-hidden bg-transparent text-[14px] leading-[1.5] text-codezal-text placeholder:text-codezal-mute focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Kontrol satırı — dar pencerede chip'ler alta wrap olur. Sağda Send butonu (absolute) için pr-12 boşluk. */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pr-12 pt-1.5">
          <AttachMenu
            onPickFile={() => {
              // TODO: dosya/foto attach pipeline'ı henüz yok
              console.info("[attach] dosya/foto seçimi TODO")
            }}
            onPickFolder={() => void pickWorkspace()}
          />

          {/* Workspace seçici sadece boş sohbette — session başlayınca zaten bağlı */}
          {msgCount === 0 && (
            <WorkspacePicker
              current={workspacePath ?? settings.defaultWorkspacePath}
              onPick={(p) => {
                if (hasActive) updateActiveMeta({ workspacePath: p })
                void updateSettings({ defaultWorkspacePath: p })
              }}
              onPickNew={pickWorkspace}
            />
          )}

          {/* Branch chip sohbet sırasında da görünür — kullanıcı mid-conversation switch edebilsin */}
          <BranchPicker
            workspace={workspacePath ?? settings.defaultWorkspacePath}
          />

          <div className="flex-1" />

          {/* Model picker — yukarı açılan custom popover. Native select Tauri'de aşağı açılıyordu. */}
          <ModelPicker
            providerId={(provider ?? settings.defaultProvider) as ProviderId}
            modelId={model ?? settings.defaultModel}
            catalog={settings.providerCatalog?.data as ProvidersCatalog | undefined}
            onPickProvider={(id) => {
              const defaultModel = defaultModelFor(
                id,
                settings.providerCatalog?.data as ProvidersCatalog | undefined,
              )
              if (hasActive) updateActiveMeta({ provider: id, model: defaultModel })
              else void updateSettings({ defaultProvider: id, defaultModel })
            }}
            onPickModel={(m) => {
              if (hasActive) updateActiveMeta({ model: m })
              else void updateSettings({ defaultModel: m })
            }}
          />

          <Chip
            onClick={() => {
              setEffort(
                effort === "high" ? "medium" : effort === "medium" ? "low" : "high",
              )
            }}
            title={t("composer.effortTitle")}
          >
            <span className="text-codezal-accent">{effortLabel}</span>
            <ChevronDown className="h-2 w-2" />
          </Chip>
        </div>

        {/* Send/Stop butonu — daima container sağ-alt köşede sabit, chip row taşmasından bağımsız */}
        {streaming ? (
          <button
            type="button"
            onClick={onAbort}
            title={t("composer.stop")}
            className="group/stop absolute bottom-2 right-2 flex h-7 w-[30px] items-center justify-center rounded-lg bg-codezal-accent/10 text-codezal-accent hover:bg-destructive/15 hover:text-destructive"
          >
            <svg
              className="absolute inset-0 h-full w-full animate-spin-slow"
              viewBox="0 0 28 28"
              fill="none"
            >
              <circle
                cx="14"
                cy="14"
                r="11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeOpacity="0.25"
              />
              <circle
                cx="14"
                cy="14"
                r="11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="18 100"
              />
            </svg>
            <span className="relative z-10 inline-flex h-2 w-2 rounded-[2px] bg-current transition-transform group-hover/stop:scale-110" />
          </button>
        ) : (
          <button
            type="button"
            onClick={trySend}
            disabled={!text.trim() || disabled}
            title={t("composer.sendHint")}
            className={cn(
              "absolute bottom-2 right-2 z-10 flex h-7 w-[30px] items-center justify-center rounded-lg transition-transform hover:scale-[1.04]",
              !text.trim() || disabled
                ? "border border-codezal bg-codezal-panel-2 text-codezal-mute hover:scale-100"
                : "bg-codezal-accent text-[#1a1106]",
            )}
          >
            <Send className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 px-1 text-[11px] text-codezal-mute">
        <ApprovalModeMenu
          mode={approvalMode}
          onChange={(m) => void updateSettings({ approvalMode: m })}
          agentMode={mode}
          onAgentModeChange={setMode}
          onOpenOrchestra={onOpenOrchestra}
        />
        <span
          className="ml-auto"
          title={t("composer.contextUsedTitle")}
        >
          {formatK(tokenCount)} / {formatK(contextCap(model ?? ""))}
        </span>
        <span className="flex items-center gap-1">⌘⏎</span>
      </div>
      </div>
    </footer>
  )
}

type ApprovalModeOption = {
  value: ApprovalMode
  label: string
  hint: string
  Icon: typeof HandIcon
  danger?: boolean
}

// Etiketleri runtime'da türet — locale değişikliği menüyü etkiler.
function buildApprovalOptions(
  tt: (k: Parameters<ReturnType<typeof useT>>[0]) => string,
): ApprovalModeOption[] {
  return [
    {
      value: "ask",
      label: tt("composer.approvalAsk"),
      hint: tt("composer.approvalAskHint"),
      Icon: HandIcon,
    },
    {
      value: "auto-review",
      label: tt("composer.approvalAutoReview"),
      hint: tt("composer.approvalAutoReviewHint"),
      Icon: Eye,
    },
    {
      value: "bypass",
      label: tt("composer.approvalBypass"),
      hint: tt("composer.approvalBypassHint"),
      Icon: AlertCircle,
      danger: true,
    },
  ]
}

function ApprovalModeMenu({
  mode,
  onChange,
  agentMode,
  onAgentModeChange,
  onOpenOrchestra,
}: {
  mode: ApprovalMode
  onChange: (m: ApprovalMode) => void
  agentMode: "build" | "plan" | "orchestra"
  onAgentModeChange: (m: "build" | "plan" | "orchestra") => void
  onOpenOrchestra?: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const APPROVAL_OPTIONS = buildApprovalOptions(t)
  const current = APPROVAL_OPTIONS.find((o) => o.value === mode) ?? APPROVAL_OPTIONS[0]

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  // Plan/orkestra modu aktifken approval mode görünmez — özel mod etiketi gösterilir.
  const planActive = agentMode === "plan"
  const orchestraActive = agentMode === "orchestra"
  const Icon = orchestraActive ? Music : planActive ? Eye : current.Icon
  const buttonLabel = orchestraActive
    ? t("composer.modeOrchestra")
    : planActive
      ? t("composer.planMode")
      : current.label
  const buttonHint = orchestraActive
    ? t("composer.orchestraModeTitle")
    : planActive
      ? t("composer.planModeTitle")
      : current.hint
  const accent = planActive || orchestraActive || current.danger
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={buttonHint}
        className={cn(
          "flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium",
          accent
            ? "border-transparent text-codezal-accent"
            : "border-codezal text-codezal-dim hover:border-codezal-strong",
        )}
      >
        <Icon className={cn("h-3 w-3", accent && "text-codezal-accent")} />
        <span>{buttonLabel}</span>
        <ChevronDown className="h-2 w-2" />
      </button>
      {open && (
        <div className="absolute bottom-[32px] left-0 z-50 w-[240px] overflow-hidden rounded-md border border-codezal bg-codezal-sidebar py-1 shadow-lg">
          {APPROVAL_OPTIONS.map((opt) => {
            // Plan/orkestra aktifken approval item'ları pasif gözükür — radio gibi.
            const active = !planActive && !orchestraActive && opt.value === mode
            const OptIcon = opt.Icon
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  // Approval seçimi build moduna döndürür (plan/orkestra'dan çıkar)
                  if (agentMode !== "build") onAgentModeChange("build")
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
                  active
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
                )}
                title={opt.hint}
              >
                <OptIcon
                  className={cn("h-3 w-3 shrink-0", opt.danger && "text-codezal-accent")}
                />
                <span className="flex-1">{opt.label}</span>
                {active && <Check className="h-3 w-3 shrink-0 text-codezal-accent" />}
              </button>
            )
          })}
          <div className="my-1 border-t border-codezal" />
          <button
            type="button"
            onClick={() => {
              onAgentModeChange("plan")
              setOpen(false)
            }}
            title={t("composer.planModeTitle")}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
              planActive
                ? "bg-codezal-panel-2/60 text-codezal-accent"
                : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
            )}
          >
            <Eye className={cn("h-3 w-3 shrink-0", planActive && "text-codezal-accent")} />
            <span className="flex-1">{t("composer.planMode")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              if (orchestraActive) {
                // Aktifse build'e dön
                onAgentModeChange("build")
              } else {
                // Aktif değilse konfigürasyon modal'ı aç (modal "Başlat" → orchestra moduna geçer)
                onOpenOrchestra?.()
              }
            }}
            title={t("composer.orchestraModeTitle")}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
              orchestraActive
                ? "bg-codezal-panel-2/60 text-codezal-accent"
                : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
            )}
          >
            <Music className={cn("h-3 w-3 shrink-0", orchestraActive && "text-codezal-accent")} />
            <span className="flex-1">{orchestraActive ? t("composer.orchestraModeClose") : `${t("composer.modeOrchestra")}…`}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function AttachMenu({
  onPickFile,
  onPickFolder,
}: {
  onPickFile: () => void
  onPickFolder: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("common.add")}
        className="flex h-[26px] shrink-0 items-center justify-center rounded-md border border-codezal px-1.5 text-codezal-dim hover:border-codezal-strong"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-[32px] left-0 z-50 w-[240px] overflow-hidden rounded-md border border-codezal bg-codezal-sidebar py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onPickFile()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text"
          >
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="flex-1">{t("composer.attachFileOrPhoto")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onPickFolder()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text"
          >
            <FolderPlus className="h-3 w-3 shrink-0" />
            <span className="flex-1">{t("composer.attachFolder")}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function Chip({
  children,
  accent,
  mono,
  onClick,
  title,
}: {
  children: React.ReactNode
  accent?: boolean
  mono?: boolean
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium",
        accent
          ? "border-transparent text-codezal-accent"
          : "border-codezal text-codezal-dim hover:border-codezal-strong",
        mono && "text-[11px]",
      )}
    >
      {children}
    </button>
  )
}

function WorkspacePicker({
  current,
  onPick,
  onPickNew,
}: {
  current?: string
  onPick: (path: string) => void
  onPickNew: () => Promise<void>
}) {
  const t = useT()
  const index = useSessionsStore((s) => s.index)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  // Bilinen projeler — index'teki tüm session'lardan eşsiz workspacePath
  const projects = useMemo(() => {
    const set = new Map<string, number>() // path → en yeni updatedAt
    for (const m of index) {
      if (!m.workspacePath) continue
      const prev = set.get(m.workspacePath) ?? 0
      if (m.updatedAt > prev) set.set(m.workspacePath, m.updatedAt)
    }
    return Array.from(set.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p)
  }, [index])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return projects
    return projects.filter((p) => basename(p).toLowerCase().includes(t) || p.toLowerCase().includes(t))
  }, [projects, q])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <Chip onClick={() => setOpen((v) => !v)} title={current ?? t("composer.pickProject")}>
        <Folder className="h-2.5 w-2.5" />
        <span>{basename(current) || t("composer.pickProjectShort")}</span>
        <ChevronDown className="h-2 w-2" />
      </Chip>
      {open && (
        <div className="absolute bottom-[32px] left-0 z-50 w-[280px] rounded-md border border-codezal bg-codezal-sidebar shadow-lg">
          <div className="border-b border-codezal-hair p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("composer.searchProject")}
              className="w-full bg-transparent px-1.5 py-1 text-[12px] text-codezal-text placeholder:text-codezal-mute outline-none"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11.5px] text-codezal-mute">
                {projects.length === 0 ? t("composer.noProjects") : t("common.noResults")}
              </div>
            )}
            {filtered.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onPick(p)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px]",
                  p === current
                    ? "bg-codezal-panel-2/60 text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
                )}
                title={p}
              >
                <Folder className="h-2.5 w-2.5 shrink-0 text-codezal-mute" />
                <span className="truncate">{basename(p)}</span>
                {p === current && <span className="ml-auto text-codezal-accent">✓</span>}
              </button>
            ))}
          </div>
          <div className="border-t border-codezal-hair py-1">
            <button
              type="button"
              onClick={async () => {
                await onPickNew()
                setOpen(false)
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[12px] text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text"
            >
              <FolderPlus className="h-2.5 w-2.5" />
              {t("composer.addNewProject")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelPicker({
  providerId,
  modelId,
  catalog,
  onPickProvider,
  onPickModel,
}: {
  providerId: ProviderId
  modelId: string
  catalog: ProvidersCatalog | undefined
  onPickProvider: (id: ProviderId) => void
  onPickModel: (m: string) => void
}) {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)
  // Selected provider in the popover. `null` means "follow the committed
  // providerId"; lets the user browse another provider's models without
  // committing the switch until they pick one. Reset to null whenever the
  // popover closes (handled in the event handlers, not an effect, to avoid
  // setState-in-effect).
  const [browseTab, setBrowseTab] = useState<ProviderId | null>(null)
  const activeTab = browseTab ?? providerId

  function closePopover() {
    setOpen(false)
    setBrowseTab(null)
    setQ("")
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) closePopover()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  // Connected providers only — the model picker should never offer a
  // provider the user has no credentials for. Sort: popular first, then
  // alphabetical.
  const adapters = useMemo(() => listProviderAdapters(catalog), [catalog])
  const connected = useMemo(
    () =>
      adapters
        .filter((p) => isConnectedSync(p, settings))
        .sort((a, b) => {
          if (Boolean(a.popular) !== Boolean(b.popular)) return a.popular ? -1 : 1
          return a.label.localeCompare(b.label)
        }),
    [adapters, settings],
  )

  // Use the tab provider for the model list. If the user clicked a tab
  // without committing, this lets them search within it.
  const models = useMemo(
    () => modelsFor(activeTab, catalog, settings.modelStatus),
    [activeTab, catalog, settings.modelStatus],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return models
    return models.filter((m) => {
      if (m.toLowerCase().includes(needle)) return true
      const name = modelDetail(catalog, activeTab, m)?.name
      return Boolean(name && name.toLowerCase().includes(needle))
    })
  }, [models, q, catalog, activeTab])

  const activeAdapter = adapters.find((p) => p.id === providerId)
  const providerLabel = activeAdapter?.label ?? String(providerId)
  const activeDisplay = modelDetail(catalog, providerId, modelId)?.name || modelId

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? closePopover() : setOpen(true))}
        className="flex h-[26px] items-center gap-1.5 rounded-md border border-codezal px-2 text-[12px] font-medium hover:border-codezal-strong"
        title={`${providerLabel} · ${modelId}`}
      >
        <span className="text-codezal-dim">{providerLabel}</span>
        <span className="text-codezal-mute">·</span>
        <span className="text-codezal-text">{activeDisplay}</span>
        <ChevronDown className="h-2 w-2 text-codezal-mute" />
      </button>
      {open && (
        <div className="absolute bottom-[32px] right-0 z-50 w-[420px] overflow-hidden rounded-md border border-codezal bg-codezal-sidebar shadow-lg">
          {connected.length === 0 ? (
            <div className="px-3 py-3 text-[11.5px] text-codezal-mute">
              {t("composer.noProvidersConnected")}
            </div>
          ) : (
            <>
              {/* Search bar spans the full width — searches model names + ids
                  within the active provider. */}
              <div className="border-b border-codezal-hair p-1.5">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("composer.searchModel")}
                  className="w-full bg-transparent px-1.5 py-1 text-[12px] text-codezal-text outline-none placeholder:text-codezal-mute"
                />
              </div>
              {/* Two-column layout: left = providers (vertical scroll),
                  right = models for the active provider (vertical scroll).
                  Fixed height so the popover doesn't jitter when a provider
                  has only a couple of models — both columns scroll instead. */}
              <div className="flex h-[320px]">
                <div className="w-[140px] shrink-0 overflow-y-auto border-r border-codezal-hair py-1">
                  {connected.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setBrowseTab(p.id)}
                      className={cn(
                        "block w-full truncate px-2.5 py-1 text-left text-[11.5px] font-medium transition-colors",
                        p.id === activeTab
                          ? "bg-codezal-accent/15 text-codezal-accent"
                          : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
                      )}
                      title={p.label}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {filtered.length === 0 && (
                    <div className="px-2.5 py-2 text-[11.5px] text-codezal-mute">
                      {t("common.noResults")}
                    </div>
                  )}
                  {filtered.map((m) => {
                    const name = modelDetail(catalog, activeTab, m)?.name?.trim()
                    const display = name || m
                    const isActive = m === modelId && activeTab === providerId
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          // Switching provider implicitly commits the tab.
                          if (activeTab !== providerId) onPickProvider(activeTab)
                          onPickModel(m)
                          closePopover()
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                          isActive
                            ? "bg-codezal-panel-2/60 text-codezal-text"
                            : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
                        )}
                        title={m}
                      >
                        <span className="truncate text-[12px] text-codezal-text">
                          {display}
                        </span>
                        {isActive && (
                          <Check className="ml-auto h-3 w-3 shrink-0 text-codezal-accent" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}
