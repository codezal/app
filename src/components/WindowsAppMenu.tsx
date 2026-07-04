import { useRef, useState } from "react"
import { Columns2, FolderPlus, GitBranch, Menu, MessageSquarePlus, Search, Settings } from "@/lib/icons"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { isWindows } from "@/lib/platform"

type Props = {
  onNewSession: () => void
  onOpenSettings: () => void
  onOpenSearch?: () => void
  onOpenFork?: () => void
  onNewProject?: () => void
  onToggleSplit?: () => void
}

export function WindowsAppMenu({ onNewSession, onOpenSettings, onOpenSearch, onOpenFork, onNewProject, onToggleSplit }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
  }

  function run(fn: () => void) {
    close()
    fn()
  }

  if (!isWindows()) return null

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("windowsMenu.title")}
        className="flex h-[22px] w-[22px] items-center justify-center rounded text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={close} />
          {/* Dropdown */}
          <div className="absolute left-0 top-full z-50 mt-1 w-52 cz-menu py-1">
            <MenuItem
              icon={<MessageSquarePlus className="h-4 w-4" />}
              label={t("commandPalette.newChat")}
              onClick={() => run(onNewSession)}
            />
            {onNewProject && (
              <MenuItem
                icon={<FolderPlus className="h-4 w-4" />}
                label={t("windowsMenu.newProject")}
                onClick={() => run(onNewProject)}
              />
            )}
            {onToggleSplit && (
              <MenuItem
                icon={<Columns2 className="h-4 w-4" />}
                label={t("windowsMenu.splitView")}
                onClick={() => run(onToggleSplit)}
              />
            )}
            {onOpenFork && (
              <MenuItem
                icon={<GitBranch className="h-4 w-4" />}
                label={t("windowsMenu.forkFromMessage")}
                onClick={() => run(onOpenFork)}
              />
            )}
            {onOpenSearch && (
              <MenuItem
                icon={<Search className="h-4 w-4" />}
                label={t("commandPalette.workspaceSearch")}
                onClick={() => run(onOpenSearch)}
              />
            )}
            <div className="my-1 border-t border-codezal" />
            <MenuItem
              icon={<Settings className="h-4 w-4" />}
              label={t("commandPalette.settings")}
              onClick={() => run(onOpenSettings)}
            />
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm",
        "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
      )}
    >
      <span className="text-codezal-mute">{icon}</span>
      {label}
    </button>
  )
}
