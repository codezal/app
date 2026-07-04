import { useMemo, useState } from "react"
import { GitBranch, Search } from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import type { Message } from "@/store/types"
import { useT } from "@/lib/i18n/useT"
import { Dialog } from "@/components/Dialog"

const EMPTY_MESSAGES: Message[] = []

type Props = {
  open: boolean
  onClose: () => void
}

export function ForkDialog({ open, onClose }: Props) {
  const t = useT()
  const [query, setQuery] = useState("")
  const messages = useSessionsStore((s) => s.active?.messages ?? EMPTY_MESSAGES)
  const forkAt = useSessionsStore((s) => s.forkAt)

  const userMessages = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({
          id: m.id,
          text: (m.content ?? "").replace(/\n/g, " ").slice(0, 200),
        }))
        .reverse(),
    [messages],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return userMessages
    return userMessages.filter((m) => m.text.toLowerCase().includes(q))
  }, [userMessages, query])

  async function handleSelect(messageId: string) {
    onClose()
    setQuery("")
    await forkAt(messageId)
  }

  if (!open) return null

  return (
    <Dialog
      onClose={onClose}
      label={t("forkDialog.openAction")}
      align="start"
      backdropClassName="z-50"
      panelClassName="mt-[15vh] w-[560px] max-h-[480px] flex flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
    >
        {/* Arama kutusu */}
        <div className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-codezal-mute" />
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm text-codezal-text placeholder:text-codezal-mute outline-none"
            placeholder={t("forkDialog.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="text-sm text-codezal-mute">esc</span>
        </div>

        {/* Mesaj listesi */}
        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-codezal-mute">
              {t("forkDialog.empty")}
            </div>
          )}
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-codezal-panel-2 text-codezal-text"
              onClick={() => handleSelect(m.id)}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
              <span className="flex-1 truncate">
                {m.text || <span className="text-codezal-mute">{t("forkDialog.emptyMessage")}</span>}
              </span>
            </button>
          ))}
        </div>
    </Dialog>
  )
}
