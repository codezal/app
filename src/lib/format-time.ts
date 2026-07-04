export function formatRowTime(ms: number, locale: string, now = Date.now()): string {
  if (!Number.isFinite(ms)) return ""
  const d = new Date(ms)
  const ref = new Date(now)
  const sameDay =
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  try {
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })
      : d.toLocaleDateString(locale, { month: "short", day: "numeric" })
  } catch {
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }
}
