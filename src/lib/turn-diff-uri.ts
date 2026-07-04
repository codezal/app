//
const PREFIX = "codezal-turndiff:"

export function isTurnDiffUri(s: string): boolean {
  return s.startsWith(PREFIX)
}

export function makeTurnDiffUri(messageId: string, focusPath?: string): string {
  const base = `${PREFIX}${encodeURIComponent(messageId)}`
  return focusPath ? `${base}:${encodeURIComponent(focusPath)}` : base
}

export function parseTurnDiffUri(uri: string): { messageId: string; focusPath: string | null } | null {
  if (!isTurnDiffUri(uri)) return null
  const rest = uri.slice(PREFIX.length)
  const sep = rest.indexOf(":")
  const messageId = decodeURIComponent(sep < 0 ? rest : rest.slice(0, sep))
  const focusPath = sep < 0 ? null : decodeURIComponent(rest.slice(sep + 1)) || null
  return messageId ? { messageId, focusPath } : null
}
