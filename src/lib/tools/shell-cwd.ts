export const PWD_SENTINEL = "__CODEZAL_PWD__"

export function extractPwd(
  stdout: string,
  sentinel: string,
): { cleaned: string; cwd: string | null } {
  const idx = stdout.lastIndexOf(sentinel)
  if (idx === -1) return { cleaned: stdout, cwd: null }
  const cwd = stdout.slice(idx + sentinel.length).split("\n")[0].trim()
  let cleaned = stdout.slice(0, idx)
  if (cleaned.endsWith("\n")) cleaned = cleaned.slice(0, -1)
  return { cleaned, cwd: cwd || null }
}

export function isWithinWorkspace(workspace: string, cwd: string): boolean {
  const root = workspace.replace(/[/\\]+$/, "")
  return cwd === root || cwd.startsWith(root + "/")
}
