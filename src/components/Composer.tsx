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
  GitBranch,
  HandIcon,
  Paperclip,
  Plus,
  Send,
} from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import type { ApprovalMode } from "@/store/types"
import { PROVIDERS, modelsFor, defaultModelFor, type ProviderId } from "@/lib/providers"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { contextCap } from "@/lib/pricing"
import { basename, pickWorkspaceFolder } from "@/lib/workspace"
import {
  listAllCommands,
  parseSlashInput,
  renderTemplate,
  type SlashCommand,
} from "@/lib/commands"
import { SlashMenu, filterCommands } from "./SlashMenu"
import { cn } from "@/lib/utils"

type Props = {
  streaming: boolean
  onSend: (text: string) => void
  onAbort: () => void
  disabled?: boolean
  placeholder?: string
  // App tarafına devredilen built-in slash aksiyonları
  onSlashAction?: (action: NonNullable<SlashCommand["action"]>, args: string) => void
}

type Effort = "low" | "medium" | "high"

export function Composer({
  streaming,
  onSend,
  onAbort,
  disabled,
  placeholder,
  onSlashAction,
}: Props) {
  const [text, setText] = useState("")
  const [effort, setEffort] = useState<Effort>("high")
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const active = useSessionsStore((s) => s.active)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const setMode = useSessionsStore((s) => s.setMode)
  const mode = active?.mode ?? "build"
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const approvalMode = settings.approvalMode

  // Slash command kataloğu — workspace değişince yenile
  useEffect(() => {
    let alive = true
    void listAllCommands(active?.workspacePath).then((cmds) => {
      if (alive) setCommands(cmds)
    })
    return () => {
      alive = false
    }
  }, [active?.workspacePath])

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
    // Aktif session'a bağla
    updateActiveMeta({ workspacePath: path })
    // Varsayılan da güncellensin → sonraki yeni session aynı klasörle açılsın
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
  // active.messages sadece UI mesajları (system + tool I/O hariç) — yanıltıcı.
  const tokenCount =
    active?.usage?.effectiveContextTokens ??
    active?.usage?.lastInputTokens ??
    estimateTokens(active?.messages ?? [])
  const effortLabel = effort === "high" ? "Yüksek" : effort === "medium" ? "Orta" : "Düşük"

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
            placeholder={placeholder ?? "Bir görev tanımla ya da / ile komut…"}
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

          {/* Klasör/branch sadece boş sohbette — devam edende session zaten bağlı */}
          {(active?.messages.length ?? 0) === 0 && (
            <>
              <WorkspacePicker
                current={active?.workspacePath}
                onPick={(p) => {
                  updateActiveMeta({ workspacePath: p })
                  void updateSettings({ defaultWorkspacePath: p })
                }}
                onPickNew={pickWorkspace}
              />

              <Chip>
                <GitBranch className="h-2.5 w-2.5" />
                <span>main</span>
                <ChevronDown className="h-2 w-2" />
              </Chip>
            </>
          )}

          <div className="flex-1" />

          {/* Model picker: provider + model native select, chip görünümünde */}
          <div className="relative flex h-[26px] items-center gap-1.5 rounded-md border border-codezal px-2 text-[12px] font-medium text-codezal-dim hover:border-codezal-strong">
            <select
              value={active?.provider ?? "openai"}
              onChange={(e) => {
                const id = e.target.value as ProviderId
                updateActiveMeta({
                  provider: id,
                  model: defaultModelFor(
                    id,
                    settings.providerCatalog?.data as ProvidersCatalog | undefined,
                  ),
                })
              }}
              className="cursor-pointer appearance-none bg-transparent pr-1 text-codezal-dim outline-none"
              title="Provider"
            >
              {Object.values(PROVIDERS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="text-codezal-mute">·</span>
            <select
              value={active?.model ?? ""}
              onChange={(e) => updateActiveMeta({ model: e.target.value })}
              className="cursor-pointer appearance-none bg-transparent pr-1 text-codezal-text outline-none"
              title="Model"
            >
              {(active?.provider
                ? modelsFor(
                    active.provider as ProviderId,
                    settings.providerCatalog?.data as ProvidersCatalog | undefined,
                  )
                : []
              )?.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <Chip
            onClick={() => {
              setEffort(
                effort === "high" ? "medium" : effort === "medium" ? "low" : "high",
              )
            }}
            title="Akıl yürütme seviyesi"
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
            title="Durdur"
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
            title="Gönder · ⌘⏎"
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
        />
        <span
          className="ml-auto"
          title="Composer giriş token tahmini / aktif modelin bağlam kapasitesi"
        >
          {formatK(tokenCount)} / {formatK(contextCap(active?.model ?? ""))}
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

const APPROVAL_OPTIONS: ApprovalModeOption[] = [
  {
    value: "ask",
    label: "Varsayılan izinler",
    hint: "Her tool çağrısında onay sorulur",
    Icon: HandIcon,
  },
  {
    value: "auto-review",
    label: "Otomatik inceleme",
    hint: "Dosya okuma/yazma otomatik, sadece bash sorulur",
    Icon: Eye,
  },
  {
    value: "bypass",
    label: "Tam erişim",
    hint: "Tüm tool çağrıları otomatik onaylanır",
    Icon: AlertCircle,
    danger: true,
  },
]

function ApprovalModeMenu({
  mode,
  onChange,
  agentMode,
  onAgentModeChange,
}: {
  mode: ApprovalMode
  onChange: (m: ApprovalMode) => void
  agentMode: "build" | "plan"
  onAgentModeChange: (m: "build" | "plan") => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = APPROVAL_OPTIONS.find((o) => o.value === mode) ?? APPROVAL_OPTIONS[0]

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  // Plan modu aktifken approval mode görünmez — salt-okunur olduğundan
  // izin seviyesinin pratik karşılığı yok. Label/icon "Plan modu" olur.
  const planActive = agentMode === "plan"
  const Icon = planActive ? Eye : current.Icon
  const buttonLabel = planActive ? "Plan modu" : current.label
  const buttonHint = planActive
    ? "Plan modu aktif — salt-okunur. Menüden kapatabilirsin (⌘M)."
    : current.hint
  const accent = planActive || current.danger
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
            // Plan aktifken approval item'ları pasif gözükür — radio gibi.
            const active = !planActive && opt.value === mode
            const OptIcon = opt.Icon
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  // Approval seçimi build moduna döndürür (plan'dan çıkar)
                  if (agentMode === "plan") onAgentModeChange("build")
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
            title="Plan modu — salt-okunur. Standart okuma/yazma izni yeterli, ek erişim seviyesine gerek yok. ⌘M ile kapat."
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
              planActive
                ? "bg-codezal-panel-2/60 text-codezal-accent"
                : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
            )}
          >
            <Eye className={cn("h-3 w-3 shrink-0", planActive && "text-codezal-accent")} />
            <span className="flex-1">Plan modu</span>
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
        title="Ekle"
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
            <span className="flex-1">Fotoğraf veya dosya ekle</span>
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
            <span className="flex-1">Klasör ekle</span>
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
      <Chip onClick={() => setOpen((v) => !v)} title={current ?? "Proje seç"}>
        <Folder className="h-2.5 w-2.5" />
        <span>{basename(current) || "proje seç"}</span>
        <ChevronDown className="h-2 w-2" />
      </Chip>
      {open && (
        <div className="absolute bottom-[32px] left-0 z-50 w-[280px] rounded-md border border-codezal bg-codezal-sidebar shadow-lg">
          <div className="border-b border-codezal-hair p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Proje ara"
              className="w-full bg-transparent px-1.5 py-1 text-[12px] text-codezal-text placeholder:text-codezal-mute outline-none"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11.5px] text-codezal-mute">
                {projects.length === 0 ? "Henüz proje yok" : "Sonuç yok"}
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
              Yeni proje ekle…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function estimateTokens(messages: { content: string }[]): number {
  return messages.reduce((n, m) => n + Math.ceil((m.content?.length ?? 0) / 4), 0)
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}
