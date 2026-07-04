// Shared settings UI primitives — used across all settings tabs.
import { cn } from "@/lib/utils"

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="text-md font-semibold tracking-tight text-codezal-text">{title}</h3>
      {description && (
        <p className="mt-1 text-md leading-relaxed text-codezal-mute">{description}</p>
      )}
      <div className="mt-3 rounded-lg border border-codezal bg-codezal-panel px-4 py-2 shadow-sm">
        {children}
      </div>
    </section>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex items-center min-h-[36px] gap-1 rounded-md bg-codezal-panel-2 px-1.5 py-0.5">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "rounded px-2.5 py-1 text-md transition-colors",
              active
                ? "bg-codezal-accent font-semibold text-white shadow-sm"
                : "text-codezal-dim hover:bg-codezal-panel hover:text-codezal-text",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-codezal-hair py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-md font-medium text-codezal-text">{label}</div>
        {description && <div className="mt-0.5 text-md leading-relaxed text-codezal-mute">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Every web-font in this list is loaded via index.css @import (Google Fonts,
// SIL OFL — free for commercial use). System fonts (SF Mono, Segoe UI, etc.)
// are guaranteed by their host OS. CSS keywords (system-ui, ui-monospace) map
// to the platform's default.
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        checked
          ? "bg-codezal-accent"
          : "border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full shadow-sm transition-transform",
          checked ? "translate-x-4 bg-white" : "translate-x-0.5 bg-white",
        )}
      />
    </button>
  )
}

export function NumberField({
  value,
  min,
  max,
  fallback,
  onChange,
}: {
  value: number
  min: number
  max: number
  fallback: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) =>
        onChange(Math.max(min, Math.min(max, Number(e.target.value) || fallback)))
      }
      className="w-16 rounded-md border border-codezal bg-codezal-input px-2 py-1 text-right text-md tabular-nums text-codezal-text outline-none focus:border-codezal-strong"
    />
  )
}
