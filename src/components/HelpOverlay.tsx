import { useEffect, useMemo, useState } from "react"
import { X } from "@/lib/icons"
import { listAllCommands, type SlashCommand } from "@/lib/commands"
import { useSessionsStore } from "@/store/sessions"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import { fmtKbd } from "@/lib/platform"
import { Dialog } from "@/components/Dialog"

type Props = {
  open: boolean
  onClose: () => void
}

function buildShortcuts(): { keys: string; label: string }[] {
  return [
    { keys: "⌘N", label: tStatic("commandPalette.newChat") },
    { keys: "⌘K", label: tStatic("helpOverlay.sPalette") },
    { keys: "⌘,", label: tStatic("helpOverlay.sSettings") },
    { keys: "⌘⇧F", label: tStatic("helpOverlay.sSearch") },
    { keys: "⌘B", label: tStatic("helpOverlay.sFilePanel") },
    { keys: "⌘⇧T", label: tStatic("helpOverlay.sTerminalPanel") },
    { keys: "⌘M", label: tStatic("helpOverlay.sPlanBuild") },
    { keys: "⌘⏎", label: tStatic("helpOverlay.sSendMessage") },
    { keys: "↑ ↓", label: tStatic("helpOverlay.sSlashNav") },
    { keys: "ESC", label: tStatic("helpOverlay.sCloseModal") },
    { keys: "⌘⇧G", label: tStatic("helpOverlay.sForkDialog") },
  ].map((s) => ({ ...s, keys: fmtKbd(s.keys) }))
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
    <Dialog
      onClose={onClose}
      labelledById="help-dialog-title"
      backdropClassName="z-[60]"
      panelClassName="flex max-h-[80vh] w-[640px] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-sidebar shadow-2xl"
    >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-codezal-hair px-4 py-3">
          <div>
            <h2 id="help-dialog-title" className="m-0 text-md font-medium text-codezal-text">
              {t("helpOverlay.headerTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-codezal-mute">
              {t("helpOverlay.headerSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
            title={t("helpOverlay.closeTitle")}
            aria-label={t("helpOverlay.closeTitle")}
          >
            <X className="h-4 w-4" aria-hidden />
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
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-codezal-dim">{s.label}</span>
                  <kbd className="rounded border border-codezal px-1.5 py-px font-mono text-sm text-codezal-dim">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("helpOverlay.addCustomSection")}>
            <p className="text-sm leading-[1.55] text-codezal-dim">
              {t("helpOverlay.addCustomDesc", { path: ".codezal/commands/<ad>.md" })}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-codezal-hair bg-codezal-panel-2/30 p-2.5 font-mono text-sm leading-[1.5] text-codezal-dim">
{`---
name: review
description: PR diff incele
---
Aşağıdaki diff'i incele:

$ARG`}
            </pre>
          </Section>
        </div>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-codezal-mute">
        {title}
      </div>
      {children}
    </section>
  )
}

function CommandTable({ cmds }: { cmds: SlashCommand[] }) {
  if (cmds.length === 0) {
    return (
      <div className="text-sm text-codezal-mute">{tStatic("helpOverlay.noCmds")}</div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-codezal-hair">
      {cmds.map((c, i) => (
        <div
          key={c.name + c.scope}
          className={cn(
            "flex items-center gap-3 px-3 py-1.5 text-sm",
            i !== cmds.length - 1 && "border-b border-codezal-hair",
          )}
        >
          <span className="shrink-0 font-mono text-sm text-codezal-accent">
            /{c.name}
            {c.needsArg && <span className="text-codezal-mute"> &lt;arg&gt;</span>}
          </span>
          <span className="truncate text-codezal-dim">{c.description}</span>
        </div>
      ))}
    </div>
  )
}
