
export function subjectFor(tool: string, input: unknown): string {
  const i = (input as Record<string, unknown>) ?? {}
  if (tool === "bash" || tool === "bash_status") return String(i.command ?? "")
  if (typeof i.path === "string") return i.path
  return ""
}
