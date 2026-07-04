// Persistent history of submitted user prompts, for the composer's Ctrl+R
// reverse search (bash-style). localStorage-backed and global across sessions —
// like a shell history file. Newest entries live at the END of the array.

const KEY = "codezal.promptHistory"
const MAX = 300

// Pure list update: drop any existing copy of `text` (so a re-sent prompt moves
// to the most-recent slot instead of duplicating), append it, and cap the list
// to `max` by dropping the oldest. Empty/whitespace input is ignored. Exported
// for tests; pushPrompt wraps it with localStorage.
export function appendHistory(hist: string[], text: string, max = MAX): string[] {
  const t = text.trim()
  if (!t) return hist
  const next = hist.filter((h) => h !== t)
  next.push(t)
  return next.length > max ? next.slice(next.length - max) : next
}

// Read the full history (oldest → newest). Tolerant of missing/corrupt storage.
export function getPromptHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

// Record a submitted prompt. No-op on empty input or when storage is unavailable.
export function pushPrompt(text: string): void {
  try {
    const next = appendHistory(getPromptHistory(), text)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage missing (tests / restricted webview) — history just won't persist.
  }
}
