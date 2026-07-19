import { isWindows } from "./platform"

export function formatTerminalPathInput(path: string, windows = isWindows()): string {
  const quoted = windows
    ? `"${path.replace(/"/g, `""`)}"`
    : `'${path.replace(/'/g, `'\\''`)}'`
  return `${quoted} `
}
