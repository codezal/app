// Claude Code reader — ~/.claude/projects/<enc-path>/<uuid>.jsonl
import type { HarnessMessage, HarnessThread, SessionSource } from "../types"
import { capText, deriveTitle, extractText, stripExt } from "../normalize"
import { childPath, dirExists, listSubdirs, makeFileSource, walkFiles } from "../io"

export function parseClaudeJsonl(text: string, filePath: string): HarnessThread | null {
  const messages: HarnessMessage[] = []
  let sessionId = ""
  let cwd: string | undefined
  let firstTs: number | undefined
  let lastTs: number | undefined

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(t) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof ev.sessionId === "string" && !sessionId) sessionId = ev.sessionId
    if (typeof ev.cwd === "string" && !cwd) cwd = ev.cwd

    if ((ev.type === "user" || ev.type === "assistant") && ev.message) {
      if (ev.isSidechain === true) continue
      const msg = ev.message as Record<string, unknown>
      const content = msg.content
      if (
        Array.isArray(content) &&
        content.some(
          (b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_result",
        )
      ) {
        continue
      }
      const role = msg.role === "assistant" ? "assistant" : "user"
      const body = extractText(msg.content).trim()
      if (!body) continue
      const ts = typeof ev.timestamp === "string" ? Date.parse(ev.timestamp) : NaN
      const tsv = Number.isFinite(ts) ? ts : undefined
      messages.push({ role, text: capText(body), ts: tsv })
      if (tsv != null) {
        if (firstTs == null) firstTs = tsv
        lastTs = tsv
      }
    }
  }

  if (messages.length === 0) return null
  const nativeId = sessionId || stripExt(filePath.split(/[/\\]/).pop() || filePath)
  return {
    id: `claude-code:${nativeId}`,
    harness: "claude-code",
    nativeId,
    projectPath: cwd,
    title: deriveTitle(messages),
    startedAt: firstTs,
    updatedAt: lastTs,
    sourceRef: filePath,
    messages,
  }
}

export async function discoverClaude(roots: string[]): Promise<SessionSource[]> {
  const sources: SessionSource[] = []
  for (const root of roots) {
    if (!(await dirExists(root))) continue
    // projects/<encDir>/*.jsonl — proje dizinlerini gez, her birinde .jsonl topla.
    for (const proj of await listSubdirs(root)) {
      const projDir = childPath(root, proj)
      for (const file of await walkFiles(projDir, ".jsonl", 1)) {
        sources.push(await makeFileSource(file, parseClaudeJsonl))
      }
    }
  }
  return sources
}
