import type { AgentRunContext } from "./types"

export function sanitizeRunContext(value: unknown): AgentRunContext {
  if (!value || typeof value !== "object") return {}
  const input = value as Record<string, unknown>
  const selectedFiles = Array.isArray(input.selectedFiles)
    ? [...new Set(input.selectedFiles.filter((file): file is string => typeof file === "string" && file.length > 0))]
    : undefined
  return {
    ...(typeof input.parentSummary === "string" ? { parentSummary: input.parentSummary } : {}),
    ...(selectedFiles?.length ? { selectedFiles } : {}),
    ...(typeof input.workspace === "string" ? { workspace: input.workspace } : {}),
    ...(typeof input.baseRevision === "string" ? { baseRevision: input.baseRevision } : {}),
  }
}
