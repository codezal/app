// ⌘K komut paleti — sessionlar, modeller, dosyalar, aksiyonlar.
// cmdk üzerine ince bir overlay; Codezal Klasik stiliyle.
import { useEffect, useMemo, useState } from "react"
import { Command } from "cmdk"
import {
  Brain,
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  Moon,
  MessageSquarePlus,
  Pencil,
  Search,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  Zap,
} from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { PROVIDERS, type ProviderId } from "@/lib/providers"
import { pickWorkspaceFolder } from "@/lib/workspace"
import { listDirShallow, type DirEntry } from "@/lib/fs-browse"

type Props = {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenSearch?: () => void
}

type Page = "root" | "model" | "session" | "file" | "theme"

export function CommandPalette({ open, onClose, onOpenSettings, onOpenSearch }: Props) {
  const [page, setPage] = useState<Page>("root")
  const [query, setQuery] = useState("")

  const active = useSessionsStore((s) => s.active)
  const index = useSessionsStore((s) => s.index)
  const create = useSessionsStore((s) => s.create)
  const openSession = useSessionsStore((s) => s.open)
  const remove = useSessionsStore((s) => s.remove)
  const updateActiveMeta = useSessionsStore((s) => s.updateActiveMeta)
  const openFile = useSessionsStore((s) => s.openFile)
  const forkAt = useSessionsStore((s) => s.forkAt)

  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)

  // Palet kapanınca sıfırla
  useEffect(() => {
    if (!open) {
      setPage("root")
      setQuery("")
    }
  }, [open])

  // Dosya tarama (sadece file sayfasında ihtiyaç var)
  const [files, setFiles] = useState<DirEntry[]>([])
  useEffect(() => {
    let alive = true
    if (page !== "file" || !active?.workspacePath) {
      setFiles([])
      return
    }
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

  // Modeller düz liste (provider/model)
  const allModels = useMemo(() => {
    const out: { provider: ProviderId; model: string }[] = []
    for (const p of Object.values(PROVIDERS)) {
      for (const m of p.models) out.push({ provider: p.id, model: m })
    }
    return out
  }, [])

  function runAndClose(fn: () => unknown | Promise<unknown>) {
    void Promise.resolve(fn()).finally(onClose)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-[15vh] w-[640px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      >
        <Command
          label="Komut paleti"
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
            // Backspace ile boşken root'a dön
            if (e.key === "Backspace" && page !== "root" && query === "") {
              e.preventDefault()
              setPage("root")
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
            {page !== "root" && (
              <span className="flex items-center gap-1 rounded bg-codezal-chip px-1.5 py-0.5 text-[10.5px] text-codezal-dim">
                {pageLabel(page)}
              </span>
            )}
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={placeholderFor(page)}
              className="flex-1 bg-transparent text-[14px] text-codezal-text placeholder:text-codezal-mute focus:outline-none"
            />
            <span className="text-[10.5px] text-codezal-mute">esc</span>
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-[12px] text-codezal-mute">
              Sonuç yok
            </Command.Empty>

            {page === "root" && (
              <>
                <Command.Group heading="Aksiyon" className="cmd-group">
                  <Item
                    icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
                    label="Yeni sohbet"
                    shortcut="⌘N"
                    onSelect={() =>
                      runAndClose(() =>
                        create(
                          settings.defaultProvider,
                          settings.defaultModel,
                          settings.defaultWorkspacePath,
                        ),
                      )
                    }
                  />
                  <Item
                    icon={<Folder className="h-3.5 w-3.5" />}
                    label="Workspace seç"
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
                      icon={<GitBranch className="h-3.5 w-3.5" />}
                      label="Son mesajdan çatal"
                      disabled={!active.messages.length}
                      onSelect={() =>
                        runAndClose(async () => {
                          const last = active.messages[active.messages.length - 1]
                          if (last) await forkAt(last.id)
                        })
                      }
                    />
                  )}
                  <Item
                    icon={<Search className="h-3.5 w-3.5" />}
                    label="Workspace içinde ara…"
                    shortcut="⌘⇧F"
                    disabled={!onOpenSearch || !active?.workspacePath}
                    onSelect={() => onOpenSearch && runAndClose(onOpenSearch)}
                  />
                  <Item
                    icon={<SettingsIcon className="h-3.5 w-3.5" />}
                    label="Ayarlar"
                    shortcut="⌘,"
                    onSelect={() => runAndClose(onOpenSettings)}
                  />
                </Command.Group>

                <Command.Group heading="Git" className="cmd-group">
                  <Item
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Model değiştir…"
                    shortcut="→"
                    onSelect={() => {
                      setPage("model")
                      setQuery("")
                    }}
                  />
                  <Item
                    icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
                    label="Sohbete geç…"
                    shortcut="→"
                    onSelect={() => {
                      setPage("session")
                      setQuery("")
                    }}
                  />
                  {active?.workspacePath && (
                    <Item
                      icon={<FileText className="h-3.5 w-3.5" />}
                      label="Dosya aç…"
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
                        <Moon className="h-3.5 w-3.5" />
                      ) : settings.theme === "light" ? (
                        <Sun className="h-3.5 w-3.5" />
                      ) : (
                        <Brain className="h-3.5 w-3.5" />
                      )
                    }
                    label="Tema değiştir…"
                    shortcut="→"
                    onSelect={() => {
                      setPage("theme")
                      setQuery("")
                    }}
                  />
                </Command.Group>
              </>
            )}

            {page === "model" &&
              allModels.map(({ provider, model }) => (
                <Item
                  key={`${provider}/${model}`}
                  icon={<Zap className="h-3.5 w-3.5" />}
                  label={model}
                  hint={PROVIDERS[provider].label}
                  active={active?.provider === provider && active?.model === model}
                  onSelect={() =>
                    runAndClose(() => updateActiveMeta({ provider, model }))
                  }
                />
              ))}

            {page === "session" &&
              index.map((s) => (
                <Item
                  key={s.id}
                  icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
                  label={s.title}
                  hint={relTime(s.updatedAt)}
                  active={active?.id === s.id}
                  onSelect={() => runAndClose(() => openSession(s.id))}
                  right={
                    <button
                      type="button"
                      title="Sil"
                      onClick={(e) => {
                        e.stopPropagation()
                        void remove(s.id)
                      }}
                      className="rounded p-1 text-codezal-mute hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  }
                />
              ))}

            {page === "file" &&
              files
                .filter((f) => !f.isDir)
                .map((f) => (
                  <Item
                    key={f.path}
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label={f.name}
                    hint={f.rel}
                    onSelect={() => runAndClose(() => openFile(f.path))}
                  />
                ))}

            {page === "theme" && (
              <>
                <Item
                  icon={<Sun className="h-3.5 w-3.5" />}
                  label="Açık"
                  active={settings.theme === "light"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "light" }))}
                />
                <Item
                  icon={<Moon className="h-3.5 w-3.5" />}
                  label="Koyu"
                  active={settings.theme === "dark"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "dark" }))}
                />
                <Item
                  icon={<Brain className="h-3.5 w-3.5" />}
                  label="Sistem"
                  active={settings.theme === "system"}
                  onSelect={() => runAndClose(() => updateSettings({ theme: "system" }))}
                />
              </>
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-codezal px-3 py-1.5 text-[10.5px] text-codezal-mute">
            <span>↑↓ gez · ⏎ seç · esc geri</span>
            <span>Codezal</span>
          </div>
        </Command>
      </div>
    </div>
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
      className="group/it flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] text-codezal-text aria-selected:bg-codezal-chip data-[disabled='true']:opacity-50"
    >
      <span className="text-codezal-mute group-aria-selected/it:text-codezal-accent">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {hint && <span className="ml-1 truncate text-[11px] text-codezal-mute">· {hint}</span>}
      <div className="flex-1" />
      {active && <Pencil className="h-3 w-3 text-codezal-accent" />}
      {shortcut && (
        <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-[10.5px] text-codezal-dim">
          {shortcut}
        </span>
      )}
      {right}
      {!right && !shortcut && (
        <ChevronRight className="h-3 w-3 text-codezal-mute opacity-0 group-aria-selected/it:opacity-100" />
      )}
    </Command.Item>
  )
}

function pageLabel(p: Page): string {
  switch (p) {
    case "model":
      return "Model"
    case "session":
      return "Sohbet"
    case "file":
      return "Dosya"
    case "theme":
      return "Tema"
    case "root":
      return ""
  }
}

function placeholderFor(p: Page): string {
  switch (p) {
    case "root":
      return "Komut ara…"
    case "model":
      return "Model ara…"
    case "session":
      return "Sohbet ara…"
    case "file":
      return "Dosya ara…"
    case "theme":
      return "Tema seç…"
  }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "az önce"
  if (m < 60) return `${m}d önce`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}s önce`
  const d = Math.floor(h / 24)
  return `${d}g önce`
}
