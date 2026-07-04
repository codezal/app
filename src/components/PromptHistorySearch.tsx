// Ctrl+R reverse history search overlay — bash-style. Self-contained state so it
// never touches the Composer's vim / mention / slash key handling. Newest match
// shows first; Ctrl+R again or ArrowDown steps to older matches, Enter accepts,
// Esc cancels. Mounted above the composer only while open.
import { useEffect, useMemo, useRef, useState } from "react"
import { getPromptHistory } from "@/lib/prompt-history"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

type Props = {
  onSelect: (text: string) => void
  onClose: () => void
}

export function PromptHistorySearch({ onSelect, onClose }: Props) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // History stores oldest→newest; reverse so the most recent prompt is first.
  const all = useMemo(() => [...getPromptHistory()].reverse(), [])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter((h) => h.toLowerCase().includes(q)) : all
  }, [all, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const clampedIdx = matches.length ? Math.min(idx, matches.length - 1) : 0
  const current = matches[clampedIdx]

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (current) onSelect(current)
      else onClose()
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "r")) {
      // Older match — Ctrl+R repeat mirrors the shell.
      e.preventDefault()
      setIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    }
  }

  return (
    <div className="absolute bottom-[100%] left-0 right-0 z-50 mb-1 cz-menu">
      <div className="flex items-center gap-2 border-b border-codezal px-3 py-2">
        <span className="shrink-0 text-sm text-codezal-mute">reverse-i-search:</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIdx(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={onClose}
          placeholder={t("promptHistory.searchPlaceholder")}
          className="w-full bg-transparent text-sm text-codezal-text outline-none placeholder:text-codezal-mute"
        />
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {matches.length === 0 ? (
          <div className="px-3 py-2 text-sm text-codezal-mute">{t("promptHistory.noMatch")}</div>
        ) : (
          matches.slice(0, 50).map((h, i) => (
            <button
              key={i}
              type="button"
              // mousedown fires before the input's blur, so select before close.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(h)
              }}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left text-sm",
                i === clampedIdx
                  ? "bg-codezal-panel-2 text-codezal-text"
                  : "text-codezal-dim hover:bg-codezal-panel-2",
              )}
              title={h}
            >
              {h}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
