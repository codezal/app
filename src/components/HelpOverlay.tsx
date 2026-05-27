// /help — slash komutlarını + kısayolları modal'da göster.
// ESC ile kapat, dışına tıkla → kapat.
import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { listAllCommands, type SlashCommand } from "@/lib/commands"
import { useSessionsStore } from "@/store/sessions"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

type Props = {
  open: boolean
  onClose: () => void
}

function buildShortcuts(): { keys: string; label: string }[] {
  return [
    { keys: "⌘N", label: tStatic("helpOverlay.sNewSession") },
    { keys: "⌘K", label: tStatic("helpOverlay.sPalette") },
    { keys: "⌘,", label: tStatic("helpOverlay.sSettings") },
    { keys: "⌘⇧F", label: tStatic("helpOverlay.sSearch") },
    { keys: "⌘B", label: tStatic("helpOverlay.sFilePanel") },
    { keys: "⌘⇧T", label: tStatic("helpOverlay.sTerminalPanel") },
    { keys: "⌘M", label: tStatic("helpOverlay.sPlanBuild") },
    { keys: "⌘⏎", label: tStatic("helpOverlay.sSendMessage") },
    { keys: "↑ ↓", label: tStatic("helpOverlay.sSlashNav") },
    { keys: "ESC", label: tStatic("helpOverlay.sCloseModal") },
  ]
}

export function HelpOverlay({ open, onClose }: Props) {
  const t = useT()
  const SHORTCUTS = useMemo(() => buildShortcuts(), [])
  const active = useSessionsStore((s) => s.active)
  const [commands, setCommands] = useState<SlashCommand[]>([])

  useEffect(() => {
    if (!open) return
    let alive = true
    void listAllCommands(active?.workspacePath).then((cmds) => {
      if (alive) setCommands(cmds)
    })
    return () => {
      alive = false
    }
  }, [open, active?.workspacePath])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const grouped = useMemo(() => {
    const builtin = commands.filter((c) => c.scope === "builtin")
    const project = commands.filter((c) => c.scope === "project")
    const global = commands.filter((c) => c.scope === "global")
    return { builtin, project, global }
  }, [commands])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[640px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-sidebar shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-codezal-hair px-4 py-3">
          <div>
            <h2 className="m-0 text-[14px] font-medium text-codezal-text">
              {t("helpOverlay.headerTitle")}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-codezal-mute">
              {t("helpOverlay.headerSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
            title={t("helpOverlay.closeTitle")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body — scroll */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <Section title={t("helpOverlay.builtinSection")}>
            <CommandTable cmds={grouped.builtin} />
          </Section>

          {grouped.project.length > 0 && (
            <Section title={t("helpOverlay.projectSection")}>
              <CommandTable cmds={grouped.project} />
            </Section>
          )}

          {grouped.global.length > 0 && (
            <Section title={t("helpOverlay.globalSection")}>
              <CommandTable cmds={grouped.global} />
            </Section>
          )}

          <Section title={t("helpOverlay.keyboardSection")}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between text-[12px]"
                >
                  <span className="text-codezal-dim">{s.label}</span>
                  <kbd className="rounded border border-codezal px-1.5 py-px font-mono text-[10.5px] text-codezal-dim">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("helpOverlay.addCustomSection")}>
            <p className="text-[12px] leading-[1.55] text-codezal-dim">
              {t("helpOverlay.addCustomDesc", { path: ".codezal/commands/<ad>.md" })}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-codezal-hair bg-codezal-panel-2/30 p-2.5 font-mono text-[11px] leading-[1.5] text-codezal-dim">
{`---
name: review
description: PR diff incele
---
Aşağıdaki diff'i incele:

$ARG`}
            </pre>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-codezal-mute">
        {title}
      </div>
      {children}
    </section>
  )
}

function CommandTable({ cmds }: { cmds: SlashCommand[] }) {
  if (cmds.length === 0) {
    return (
      <div className="text-[12px] text-codezal-mute">{tStatic("helpOverlay.noCmds")}</div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-codezal-hair">
      {cmds.map((c, i) => (
        <div
          key={c.name + c.scope}
          className={cn(
            "flex items-center gap-3 px-3 py-1.5 text-[12px]",
            i !== cmds.length - 1 && "border-b border-codezal-hair",
          )}
        >
          <span className="shrink-0 font-mono text-[11.5px] text-codezal-accent">
            /{c.name}
            {c.needsArg && <span className="text-codezal-mute"> &lt;arg&gt;</span>}
          </span>
          <span className="truncate text-codezal-dim">{c.description}</span>
        </div>
      ))}
    </div>
  )
}
