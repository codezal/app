const WINDOW_MS = 750
const marks = new Map<string, number>()

export function markSelfWrite(path: string): void {
  marks.set(path, Date.now())
}

export function consumeSelfWrite(path: string): boolean {
  const at = marks.get(path)
  if (at === undefined) return false
  if (Date.now() - at < WINDOW_MS) return true
  marks.delete(path) // bayat → temizle
  return false
}
