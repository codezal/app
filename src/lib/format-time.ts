// Sidebar row timestamp. Uses a compact, language-neutral *relative* form
// ("3m", "2h", "1d") so "how recently was this active" reads at a glance —
// mirroring common IDE sidebars. Beyond a week it falls back to a short
// absolute date. The full absolute timestamp lives in formatRowTimeAbsolute
// (used for the hover/title tooltip).
export function formatRowTime(ms: number, locale?: string, now = Date.now()): string {
  if (!Number.isFinite(ms)) return ""
  const diff = now - ms
  if (!Number.isFinite(diff) || diff < 0) return formatAbsolute(ms, locale)

  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return "<1m"
  if (diff < hour) return `${Math.floor(diff / min)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`
  return formatAbsolute(ms, locale)
}

// Full locale-aware point-in-time string for hover/title (absolute).
export function formatRowTimeAbsolute(ms: number, locale?: string): string {
  if (!Number.isFinite(ms)) return ""
  return formatAbsolute(ms, locale)
}

function formatAbsolute(ms: number, locale?: string): string {
  const d = new Date(ms)
  const loc = locale && locale !== "" ? locale : undefined
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }
  try {
    return d.toLocaleString(loc, opts)
  } catch {
    return d.toLocaleString(undefined, opts)
  }
}
