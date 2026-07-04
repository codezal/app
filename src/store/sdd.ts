// preview.ts / generated-images.ts deseninde zustand. Disk I/O burada (fs-safe +
import { create } from "zustand"
import { exists, mkdir, readDir } from "@tauri-apps/plugin-fs"
import { readTextFileSafe, writeTextFileSafe } from "@/lib/fs-safe"
import { isDirty } from "@/lib/editor-dirty"
import { createId } from "@/lib/id"
import {
  defaultRequirementMarkdown,
  sddDraftDir,
  sddImgDir,
  sddMetaPath,
  sddPlanPath,
  sddProtoDir,
  sddRequirementPath,
} from "@/lib/sdd-store"
import {
  parseCoveredRequirementIds,
  parseRequirementBlocks,
  setRequirementStatuses,
  type SddStatus,
} from "@/lib/sdd-trace"
import type { SddDraft, SddStage } from "./types"

type SddState = {
  drafts: Record<string, SddDraft>
  createDraft: (workspace: string, title: string) => Promise<SddDraft>
  setStage: (id: string, stage: SddStage) => void
  linkSession: (id: string, sessionId: string) => void
  loadDrafts: (workspace: string) => Promise<void>
  applyTrace: (draftId: string, target: SddStatus) => Promise<boolean>
}

async function persistMeta(d: SddDraft): Promise<void> {
  try {
    await writeTextFileSafe(sddMetaPath(d.workspacePath, d.id), JSON.stringify(d, null, 2))
  } catch {
    // Intentionally ignored.
  }
}

export const useSddStore = create<SddState>((set, get) => ({
  drafts: {},

  createDraft: async (workspace, title) => {
    const id = createId("sdd")
    const now = Date.now()
    const draft: SddDraft = {
      id,
      title,
      stage: "requirement",
      workspacePath: workspace,
      createdAt: now,
      updatedAt: now,
    }
    const dir = sddDraftDir(workspace, id)
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    await mkdir(sddImgDir(workspace, id), { recursive: true }).catch(() => {})
    await mkdir(sddProtoDir(workspace, id), { recursive: true }).catch(() => {})
    await writeTextFileSafe(sddRequirementPath(workspace, id), defaultRequirementMarkdown(title))
    await persistMeta(draft)
    set((st) => ({ drafts: { ...st.drafts, [id]: draft } }))
    return draft
  },

  setStage: (id, stage) =>
    set((st) => {
      const d = st.drafts[id]
      if (!d || d.stage === stage) return st
      const next: SddDraft = { ...d, stage, updatedAt: Date.now() }
      void persistMeta(next)
      return { drafts: { ...st.drafts, [id]: next } }
    }),

  linkSession: (id, sessionId) =>
    set((st) => {
      const d = st.drafts[id]
      if (!d || d.assistantSessionId === sessionId) return st
      const next: SddDraft = { ...d, assistantSessionId: sessionId, updatedAt: Date.now() }
      void persistMeta(next)
      return { drafts: { ...st.drafts, [id]: next } }
    }),

  loadDrafts: async (workspace) => {
    const root = `${workspace.replace(/[\\/]+$/, "")}/.codezal/sdd`
    if (!(await exists(root))) return
    try {
      const entries = await readDir(root)
      const loaded: Record<string, SddDraft> = {}
      for (const e of entries) {
        if (!e.isDirectory) continue
        try {
          const raw = await readTextFileSafe(sddMetaPath(workspace, e.name))
          const d = JSON.parse(raw) as SddDraft
          if (d?.id) loaded[d.id] = d
        } catch {
          // Intentionally ignored.
        }
      }
      set((st) => ({ drafts: { ...loaded, ...st.drafts } }))
    } catch {
      // Intentionally ignored.
    }
  },

  applyTrace: async (draftId, target) => {
    const d = get().drafts[draftId]
    if (!d) return false
    const reqP = sddRequirementPath(d.workspacePath, d.id)
    if (isDirty(reqP)) return false
    let reqMd: string
    try {
      reqMd = await readTextFileSafe(reqP)
    } catch {
      return false
    }
    let planMd = ""
    try {
      const planP = sddPlanPath(d.workspacePath, d.id)
      if (await exists(planP)) planMd = await readTextFileSafe(planP)
    } catch {
      // Intentionally ignored.
    }
    const covered = parseCoveredRequirementIds(planMd)
    const updates: Record<string, SddStatus> = {}
    for (const b of parseRequirementBlocks(reqMd)) {
      if (covered.has(b.id)) updates[b.id] = target
    }
    const next = setRequirementStatuses(reqMd, updates)
    if (next === reqMd) return false
    try {
      await writeTextFileSafe(reqP, next)
      return true
    } catch {
      return false
    }
  },
}))
