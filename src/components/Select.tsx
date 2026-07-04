import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "@/lib/icons"
import { cn } from "@/lib/utils"

export type SelectOption = {
  value: string
  label: string
  style?: React.CSSProperties
}

export function Select({
  value,
  onChange,
  options,
  compact,
  placeholder,
  triggerStyle,
  wrapperClassName,
  triggerClassName,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  compact?: boolean
  placeholder?: string
  triggerStyle?: React.CSSProperties
  wrapperClassName?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    if (opts.length === 0) return
    e.preventDefault()
    const idx = opts.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === "ArrowDown"
        ? opts[idx < 0 ? 0 : (idx + 1) % opts.length]
        : opts[idx <= 0 ? opts.length - 1 : idx - 1]
    next?.focus()
  }

  const current = options.find((o) => o.value === value)
  return (
    <div ref={wrapRef} className={cn("relative", compact && "inline-block", wrapperClassName)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={triggerStyle}
        className={cn(
          compact
            ? "flex items-center gap-1 rounded border border-codezal bg-codezal-input px-1.5 py-0.5 text-sm text-codezal-text hover:border-codezal-strong"
            : "codezal-select text-left",
          triggerClassName,
        )}
      >
        <span className="block truncate">{current?.label ?? placeholder ?? value}</span>
        {compact && <ChevronDown className="h-3 w-3 shrink-0 text-codezal-mute" />}
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-y-auto cz-menu p-1.5",
            compact && "min-w-[150px]",
          )}
        >
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                style={o.style}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-codezal-panel-2 hover:text-codezal-text",
                  compact ? "text-sm" : "text-base",
                  active ? "text-codezal-text" : "text-codezal-dim",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <Check
                  aria-hidden
                  className={cn(
                    "h-4 w-4 shrink-0 text-codezal-accent",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
