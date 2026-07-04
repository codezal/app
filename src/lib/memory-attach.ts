//
//
//
import { exists, readTextFile } from "@tauri-apps/plugin-fs"

const INSTRUCTION_FILES = ["AGENTS.md", "CODEZAL.md", "CLAUDE.md", "AGENT.md"]
const MAX_ATTACH_BYTES = 16_000

const attached = new Map<string, Set<string>>()

export function resetAttach(sessionId: string): void {
  attached.delete(sessionId)
}

function seenSet(sid: string): Set<string> {
  let s = attached.get(sid)
  if (!s) {
    s = new Set()
    attached.set(sid, s)
  }
  return s
}


function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "")
}
function dirOf(p: string): string {
  const s = norm(p)
  const i = s.lastIndexOf("/")
  return i <= 0 ? s : s.slice(0, i)
}
function join(dir: string, name: string): string {
  return norm(dir) + "/" + name
}
function isInside(root: string, p: string): boolean {
  const r = norm(root)
  const x = norm(p)
  return x === r || x.startsWith(r + "/")
}

const _enc = new TextEncoder()
function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = _enc.encode(s)
  if (bytes.length <= maxBytes) return s
  let out = new TextDecoder("utf-8").decode(bytes.slice(0, maxBytes))
  if (out.endsWith("�")) out = out.slice(0, -1)
  return out + "\n[... kesildi]"
}

export async function attachNestedMemory(
  workspace: string | undefined,
  fileAbs: string,
  sessionId: string,
): Promise<string> {
  if (!workspace) return ""
  const root = norm(workspace)
  const start = dirOf(fileAbs)
  if (!isInside(root, start) || start === root) return ""

  const seen = seenSet(sessionId)
  const blocks: string[] = []
  let cur = start

  while (isInside(root, cur) && cur !== root) {
    let found: string | null = null
    for (const name of INSTRUCTION_FILES) {
      const p = join(cur, name)
      const ok = await exists(p).catch(() => false)
      if (ok) {
        found = p
        break
      }
    }
    if (found && !seen.has(found)) {
      seen.add(found)
      const content = await readTextFile(found).catch(() => null)
      if (content && content.trim()) {
        const rel = found.startsWith(root + "/") ? found.slice(root.length + 1) : found
        blocks.push(`Instructions from ${rel}:\n${truncateToBytes(content.trim(), MAX_ATTACH_BYTES)}`)
      }
    }
    cur = dirOf(cur)
  }

  if (blocks.length === 0) return ""
  return `\n\n<system-reminder>\n${blocks.join("\n\n")}\n</system-reminder>`
}
