// ⌘K komut paleti — sessionlar, modeller, dosyalar, aksiyonlar.
import { useEffect, useMemo, useState } from "react"
import { Command } from "cmdk"
import {
  Brain,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  Gauge,
  GitBranch,
  Moon,
  MessageSquarePlus,
  Pencil,
  Plug,
  Search,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  Zap,
} from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import {
  type ProviderId,
  listProviderAdapters,
  modelsFor,
  isConnectedSync,
  probeEnvVars,
} from "@/lib/providers"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { resolveSessionDefaults } from "@/lib/session-defaults"
import { pickWorkspaceFolder } from "@/lib/workspace"
import { listDirShallow, type DirEntry } from "@/lib/fs-browse"
import { useT } from "@/lib/i18n/useT"
import { t as tStaticCp } from "@/lib/i18n"
import { fmtKbd } from "@/lib/platform"
import { Dialog } from "@/components/Dialog"
import { copySessionToClipboard } from "@/lib/session-export"
import { StatsView } from "@/components/StatsView"
import { toast } from "@/store/toast"

export type Page = "root" | "model" | "session" | "file" | "theme" | "stats"

type Props = {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenSearch?: () => void
  onOpenFork?: () => void
  initialPage?: Page
}

export function CommandPalette({ open, onClose, onOpenSettings, onOpenSearch, onOpenFork, initialPage = "root" }: Props) {
  const t = useT()
  const [page, setPage] = useState<Page>("root")
  const [query, setQuery] = useState("")

  const active = useSessionsStore((s) => s.active)
  const index = useSessionsStore((s) => s.index)
  const create = useSessionsStore((s) => s.create)
  const lastSessionContext = useSessionsStore((s) => s.lastSessionContext)
  const openSession = useSessionsStore((s) => s.open)
  const remove = useSessionsStore((s) => s.remove)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const openFile = useSessionsStore((s) => s.openFile)
  const forkAt = useSessionsStore((s) => s.forkAt)

  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setQuery("")
    setPage(open ? initialPage : "root")
  }

  const [files, setFiles] = useState<DirEntry[]>([])
  useEffect(() => {
    if (page !== "file" || !active?.workspacePath) return
    let alive = true
    void (async () => {
      try {
        const list = await listDirShallow(active.workspacePath!, 500)
        if (alive) setFiles(list)
      } catch {
        if (alive) setFiles([])
      }
    })()
    return () => {
      alive = false
    }
  }, [page, active?.workspacePath])

  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const adapters = useMemo(
    () => listProviderAdapters(catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, settings.customProviders],
  )
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!open) return
    const unique = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    void probeEnvVars(unique).then(setEnvHits)
  }, [open, adapters])
  const allModels = useMemo(() => {
    const out: { provider: ProviderId; model: string; label: string }[] = []
    for (const p of adapters) {
      if (!isConnectedSync(p, settings, envHits)) continue
      for (const m of modelsFor(p.id, catalog, settings.modelStatus)) {
        out.push({ provider: p.id, model: m, label: p.label })
      }
    }
    return out
  }, [adapters, settings, envHits, catalog])

  function runAndClose(fn: () => unknown | Promise<unknown>) {
    void Promise.resolve(fn()).finally(onClose)
  }

  if (!open) return null

  return (
    <Dialog
      onClose={onClose}
      label={t("commandPalette.label")}
      align="start"
      backdropClassName="z-50"
      panelClassName="mt-[15vh] w-[640px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      closeOnEscape={false}
    >
        <Command
          label={t("commandPalette.label")}
          className="flex flex-col"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (page !== "root") {
                e.preventDefault()
                setPage("root")
                setQuery("")
              } else {
                onClose()
              }
            }
            if (e.key === "Backspace" && page !== "root" && query === "") {
              e.preventDefault()
              setPage("root")
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
            {page !== "root" && (
              <span className="flex items-center gap-1 rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
                {pageLabel(page, t)}
              </span>
            )}
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={placeholderFor(page, t)}
              className="flex-1 bg-transparent text-md text-codezal-text placeholder:text-codezal-mute focus:outline-none"
            />
            <span className="text-sm text-codezal-mute">esc</span>
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-codezal-mute">
              {t("commandPalette.noResults")}
            </Command.Empty>

            {page === "root" && (
              <>
                <Command.Group heading={t("commandPalette.actionsGroup")} className="cmd-group">
                  <Item
                    icon={<MessageSquarePlus className="h-4 w-4" />}
                    label={t("commandPalette.newChat")}
                    shortcut={fmtKbd("⌘N")}
                    onSelect={() =>
                      runAndClose(async () => {
                        const ctx = await lastSessionContext({
                          provider: settings.defaultProvider,
                          model: settings.defaultModel,
                          reasoningEffort: settings.reasoningEffort,
                        })
                        const pm = useSessionsStore.getState().projectMeta
                        const d = resolveSessionDefaults(ctx.workspacePath ? pm[ctx.workspacePath] : undefined, settings)
                        await create(d.provider, d.model, ctx.workspacePath, ctx.reasoningEffort)
                      })
                    }
                  />
                  <Item
                    icon={<Folder className="h-4 w-4" />}
                    label={t("commandPalette.workspaceSelect")}
                    onSelect={() =>
                      runAndClose(async () => {
                        const p = await pickWorkspaceFolder()
                        if (!p) return
                        updateActiveMeta({ workspacePath: p })
                        void updateSettings({ defaultWorkspacePath: p })
                      })
                    }
                  />
                  {active && (
                    <Item
                      icon={<GitBranch className="h-4 w-4" />}
                      label={t("commandPalette.forkLast")}
                      disabled={!active.messages.length}
                      onSelect={() =>
                        runAndClose(async () => {
                          const last = active.messages[active.messages.length - 1]
                          if (last) await forkAt(last.id)
                        })
                      }
                    />
                  )}
                  {active && onOpenFork && (
                    <Item
                      icon={<GitBranch className="h-4 w-4" />}
                      label={t("forkDialog.openAction")}
                      disabled={!active.messages.filter((m) => m.role === "user").length}
                      onSelect={() => runAndClose(onOpenFork)}
                    />
                  )}
                  {active && (
                    <Item
                      icon={<Copy className="h-4 w-4" />}
                      label={t("commandPalette.exportSession") ?? "Export session as markdown"}
                      disabled={!active.messages.length}
                      onSelect={() =>
                        runAndClose(async () => {
                          await copySessionToClipboard(active)
                          toast.success(t("commandPalette.exportSessionCopied") ?? "Copied to clipboard")
                        })
                      }
                    />
                  )}
                  <Item
                    icon={<Search className="h-4 w-4" />}
                    label={t("commandPalette.workspaceSearch")}
                    shortcut={fmtKbd("⌘⇧F")}
                    disabled={!onOpenSearch || !active?.workspacePath}
                    onSelect={() => onOpenSearch && runAndClose(onOpenSearch)}
                  />
                  <Item
                    icon={<SettingsIcon className="h-4 w-4" />}
                    label={t("commandPalette.settings")}
                    shortcut={fmtKbd("⌘,")}
                    onSelect={() => runAndClose(onOpenSettings)}
                  />
                  <Item
                    icon={<GitBranch className="h-4 w-4" />}
                    label={t("commandPalette.commitSignatureLabel", {
                      state:
                        settings.commitAttribution === false
                          ? t("commandPalette.commitSignatureOff")
                          : t("commandPalette.commitSignatureOn"),
                    })}
                    onSelect={() =>
                      runAndClose(async () => {
                        const next = settings.commitAttribution === false
                        await updateSettings({ commitAttribution: next })
                        toast.success(
                          next
                            ? t("commandPalette.commitSignatureEnabled")
                            : t("commandPalette.commitSignatureDisabled"),
                        )
                      })
                    }
                  />
                  <Item
                    icon={<Gauge className="h-4 w-4" />}
                    label={t("commandPalette.stats")}
                    onSelect={() => {
                      setPage("stats")
                      setQuery("")
                    }}
                  />
                </Command.Group>

                <Command.Group heading={t("commandPalette.navigateGroup")} className="cmd-group">
                  <Item
                    icon={<Zap className="h-4 w-4" />}
                    label={t("commandPalette.switchModel")}
                    shortcut="→"
                    onSelect={() => {
                      setPage("model")
                      setQuery("")
                    }}
                  />
                  <Item
                    icon={<MessageSquarePlus className="h-4 w-4" />}
                    label={t("commandPalette.switchSession")}
                    shortcut="→"
                    onSelect={() => {
                      setPage("session")
                      setQuery("")
                    }}
                  />
                  {active?.workspacePath && (
                    <Item
                      icon={<FileText className="h-4 w-4" />}
                      label={t("commandPalette.openFile")}
                      shortcut="→"
                      onSelect={() => {
                        setPage("file")
                        setQuery("")
                      }}
                    />
                  )}
                  <Item
                    icon={
                      settings.theme === "dark" ? (
                        <Moon className="h-4 w-4" />
                      ) : settings.theme === "light" ? (
                        <Sun className="h-4 w-4" />
                      ) : (
                        <Brain className="h-4 w-4" />
                      )
                    }
                    label={t("commandPalette.changeTheme")}
                    shortcut="→"
                    onSelect={() => {
                      setPage("theme")
                      setQuery("")
                    }}
                  />
                </Command.Group>

                {(settings.mcpServers ?? []).length > 0 && (
                  <Command.Group heading="MCP" className="cmd-group">
                    {(settings.mcpServers ?? []).map((s) => {
                      const on = s.enabled !== false
                      return (
                        <Item
                          key={s.name}
                          icon={<Plug className="h-4 w-4" />}
                          label={
                            on
                              ? t("commandPalette.mcpDisable", { name: s.name })
                              : t("commandPalette.mcpEnable", { name: s.name })
                          }
                          onSelect={() =>
                            runAndClose(async () => {
                              const next = (settings.mcpServers ?? []).map((x) =>
                                x.name === s.name ? { ...x, enabled: !on } : x,
                              )
                              await updateSettings({ mcpServers: next })
                              toast.success(
                                on
                                  ? t("commandPalette.mcpDisabledToast", { name: s.name })
                                  : t("commandPalette.mcpEnabledToast", { name: s.name }),
                              )
                            })
                          }
                        />
                      )
                    })}
                  </Command.Group>
                )}
              </>
            )}

            {page === "stats" && <StatsView />}

            {page === "model" &&
              allModels.map(({ provider, model, label }) => (
                <Item
                  key={`${provider}/${model}`}
                  icon={<Zap className="h-4 w-4" />}
                  label={model}
                  hint={label}
                  active={active?.provider === provider && active?.model === model}
                  onSelect={() =>
                    runAndClose(() => updateActiveMeta({ provider, model }))
                  }
                />
              ))}

            {page === "session" &&
              (() => {
                const renderSession = (s: (typeof index)[number]) => (
                  <Item
                    key={s.id}
                    icon={<MessageSquarePlus className="h-4 w-4" />}
                    label={s.title}
                    hint={relTime(s.updatedAt)}
                    active={active?.id === s.id}
                    onSelect={() => runAndClose(() => openSession(s.id))}
                    right={
                      <button
                        type="button"
                        title={t("commandPalette.deleteHint")}
                        onClick={(e) => {
                          e.stopPropagation()
                          void remove(s.id)
                        }}
                        className="rounded p-1 text-codezal-mute hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    }
                  />
                )
                const unread = index
                  .filter((s) => s.unread)
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                if (unread.length === 0) return index.map(renderSession)
                const rest = index.filter((s) => !s.unread)
                return (
                  <>
                    <Command.Group heading={t("commandPalette.unreadHeading")} className="cmd-group">
                      {unread.map(renderSession)}
                    </Command.Group>
                    {rest.length > 0 && (
                      <Command.Group heading={t("commandPalette.recent")} className="cmd-group">
                        {rest.map(renderSession)}
                      </Command.Group>
                    )}
                  </>
                )
              })()}

            {page === "file" &&
              files
                .filter((f) => !f.isDir)
                .map((f) => (
                  <Item
                    key={f.path}
                    icon={<FileText className="h-4 w-4" />}
                    label={f.name}
                    hint={f.rel}
                    onSelect={() => runAndClose(() => openFile(f.path))}
                  />
                ))}

            {page === "theme" && (
              <>
                <Item
                  icon={<Sun className="h-4 w-4" />}
                  label={t("commandPalette.themeLight")}
                  active={settings.theme === "light"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "light" }))}
                />
                <Item
                  icon={<Moon className="h-4 w-4" />}
                  label={t("commandPalette.themeDark")}
                  active={settings.theme === "dark"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "dark" }))}
                />
                <Item
                  icon={<Brain className="h-4 w-4" />}
                  label={t("commandPalette.themeSystem")}
                  active={settings.theme === "system"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "system" }))}
                />
              </>
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-codezal px-3 py-1.5 text-sm text-codezal-mute">
            <span>{t("commandPalette.footerHelp")}</span>
            <span>Codezal</span>
          </div>
        </Command>
    </Dialog>
  )
}

function Item({
  icon,
  label,
  hint,
  shortcut,
  active,
  disabled,
  onSelect,
  right,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onSelect: () => void
  right?: React.ReactNode
}) {
  return (
    <Command.Item
      value={`${label} ${hint ?? ""}`}
      disabled={disabled}
      onSelect={onSelect}
      className="group/it flex items-center gap-2.5 rounded px-2.5 py-1.5 text-base text-codezal-text aria-selected:bg-codezal-chip data-[disabled='true']:opacity-50"
    >
      <span className="text-codezal-mute group-aria-selected/it:text-codezal-accent">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {hint && <span className="ml-1 truncate text-sm text-codezal-mute">· {hint}</span>}
      <div className="flex-1" />
      {active && <Pencil className="h-4 w-4 text-codezal-accent" />}
      {shortcut && (
        <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
          {shortcut}
        </span>
      )}
      {right}
      {!right && !shortcut && (
        <ChevronRight className="h-4 w-4 text-codezal-mute opacity-0 group-aria-selected/it:opacity-100" />
      )}
    </Command.Item>
  )
}

function pageLabel(p: Page, tt: ReturnType<typeof useT>): string {
  switch (p) {
    case "model":
      return tt("commandPalette.pageModel")
    case "session":
      return tt("commandPalette.pageSession")
    case "file":
      return tt("commandPalette.pageFile")
    case "theme":
      return tt("commandPalette.pageTheme")
    case "stats":
      return tt("commandPalette.stats")
    case "root":
      return ""
  }
}

function placeholderFor(p: Page, tt: ReturnType<typeof useT>): string {
  switch (p) {
    case "root":
      return tt("commandPalette.placeholderRoot")
    case "model":
      return tt("commandPalette.placeholderModel")
    case "session":
      return tt("commandPalette.placeholderSession")
    case "file":
      return tt("commandPalette.placeholderFile")
    case "theme":
      return tt("commandPalette.placeholderTheme")
    case "stats":
      return ""
  }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return tStaticCp("commandPalette.relJustNow")
  if (m < 60) return tStaticCp("commandPalette.relMin", { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return tStaticCp("commandPalette.relHour", { n: h })
  const d = Math.floor(h / 24)
  return tStaticCp("commandPalette.relDay", { n: d })
}
