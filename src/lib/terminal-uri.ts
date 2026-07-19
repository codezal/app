export const TERMINAL_URI = "codezal-terminal:"

export function isTerminalUri(uri: string): boolean {
  return uri.startsWith(TERMINAL_URI)
}

export function makeTerminalUri(terminalId: string): string {
  return `${TERMINAL_URI}${encodeURIComponent(terminalId)}`
}

export function parseTerminalUri(uri: string): string | null {
  if (!isTerminalUri(uri)) return null
  const encoded = uri.slice(TERMINAL_URI.length)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}
