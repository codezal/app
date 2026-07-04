// blob'lar). Diff URI'lerine (diff-uri.ts) paralel: tab modeli `openFiles: string[]`
//

const PREFIX = "codezal-output:"
const MAX_ENTRIES = 50

const store = new Map<string, string>()
let seq = 0

export function isOutputUri(s: string): boolean {
  return s.startsWith(PREFIX)
}

export function makeOutputDoc(title: string, content: string): string {
  const id = `o${++seq}`
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(id, content)
  return `${PREFIX}${id}:${encodeURIComponent(title)}`
}

export function parseOutputUri(uri: string): { id: string; title: string } | null {
  if (!isOutputUri(uri)) return null
  const rest = uri.slice(PREFIX.length)
  const i = rest.indexOf(":")
  if (i < 0) return null
  return { id: rest.slice(0, i), title: decodeURIComponent(rest.slice(i + 1)) }
}

export function getOutputContent(id: string): string | undefined {
  return store.get(id)
}
