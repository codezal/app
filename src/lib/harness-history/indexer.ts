import { homeDir } from "@tauri-apps/api/path"
import { db } from "@/lib/db"
import type { HarnessKind, SessionSource } from "./types"
import { harnessRoots, normalizeOS, type HistoryOS } from "./paths"
import { discoverClaude } from "./readers/claude-code"
import { discoverCodex } from "./readers/codex"
import { discoverOpencode } from "./readers/opencode"
import { discoverCursor } from "./readers/cursor"
import {
  ensureHistorySchema,
  getIndexedMtimes,
  pruneMissing,
  upsertThread,
} from "./store"

export type IndexableHarness = HarnessKind

const DISCOVERERS: Record<IndexableHarness, (roots: string[]) => Promise<SessionSource[]>> = {
  "claude-code": discoverClaude,
  codex: discoverCodex,
  opencode: discoverOpencode,
  cursor: discoverCursor,
}

async function currentOS(): Promise<HistoryOS> {
  const osMod = await import("@tauri-apps/plugin-os")
  return normalizeOS(osMod.platform())
}

export type ReindexResult = {
  indexed: number
  skipped: number
  removed: number
  failed: number // load/parse null
}

export async function reindexHistory(
  harnesses: IndexableHarness[] = ["claude-code", "codex", "opencode", "cursor"],
): Promise<ReindexResult> {
  await ensureHistorySchema(db)
  const home = (await homeDir()).replace(/[\\/]+$/, "")
  const os = await currentOS()
  const known = await getIndexedMtimes(db)
  const seen = new Set<string>()
  const res: ReindexResult = { indexed: 0, skipped: 0, removed: 0, failed: 0 }
  const now = Date.now()

  for (const h of harnesses) {
    const roots = harnessRoots(h, home, os)
    const sources = await DISCOVERERS[h](roots)
    for (const s of sources) {
      const id = `${h}:${s.nativeId}`
      seen.add(id)
      const prev = known.get(id)
      if (prev != null && prev === s.mtime) {
        res.skipped++
        continue
      }
      const thread = await s.load()
      if (!thread) {
        res.failed++
        continue
      }
      await upsertThread(db, thread, s.mtime, now)
      res.indexed++
    }
  }

  res.removed = await pruneMissing(db, seen, new Set(harnesses))
  return res
}
