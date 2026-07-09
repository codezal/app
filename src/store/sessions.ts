import { create } from "zustand"
import { withLock } from "@/lib/lock"
import { clearDirty } from "@/lib/editor-dirty"
import { forgetScrollPosition } from "@/lib/scroll-memory"
import { clearToolBeat } from "@/lib/tool-heartbeat"
import { clearDraft } from "@/lib/editor-drafts"
import {
  bootstrapDb,
  db,
  deleteMessage as dbDeleteMessage,
  deleteProject,
  deleteSessionRow,
  forkCopy,
  insertMessageInto,
  listProjects,
  listSessionMetas,
  listSessionsByRoutineId,
  loadAllMessages,
  loadMessagesPage,
  loadSessionScalar,
  messageIdx as dbMessageIdx,
  nextMessageSeq,
  persistParts,
  persistModelMessages,
  loadModelMessages,
  setProjectsOrder as dbSetProjectsOrder,
  updateMessageRow,
  updateSessionColumns,
  upsertProject,
  upsertSessionRow,
} from "@/lib/db"
import type { SessionColumnPatch } from "@/lib/db"
import {
  checkpoint,
  clearSession as clearSnapshotSession,
  revertToBase,
  revertFileToBase,
  fileAtBase,
} from "@/lib/snapshots"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { lineDiff, type DiffLine } from "@/lib/diff"
import { revertHunk } from "@/lib/hunk-revert"
import { resolveInWorkspace } from "@/lib/tools/paths"
import { abortStream } from "@/lib/run-registry"
import { planSessionEviction, MAX_HYDRATED_SESSIONS } from "@/lib/session-evict"
import type { ProviderId, ReasoningEffort } from "@/lib/providers"
import { createId } from "@/lib/id"
import { t as tStatic } from "@/lib/i18n"
import type { ModelMessage } from "ai"
import type { AgentCardPart, OrchestraConfig } from "@/lib/orchestra/types"
import type { AgentMode, Message, Part, ProjectMeta, Session, SessionGoal, SessionMeta, SideChatMessage, SideChatThread, TodoItem } from "./types"


function makeEmptySession(
  provider: ProviderId,
  model: string,
  workspacePath?: string,
  reasoningEffort?: ReasoningEffort,
  routineId?: string,
): Session {
  const now = Date.now()
  const s: Session = {
    id: createId("session"),
    title: tStatic("commandPalette.newChat"),
    updatedAt: now,
    messages: [],
    provider,
    model,
    workspacePath,
    mode: "build",
  }
  // (Session.reasoningEffort ?? settings.reasoningEffort ?? "medium").
  if (reasoningEffort) s.reasoningEffort = reasoningEffort
  if (routineId) s.routineId = routineId
  return s
}

export type NewSessionContext = {
  provider: ProviderId
  model: string
  reasoningEffort?: ReasoningEffort
  workspacePath?: string
}

type UsageDelta = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  costUsd: number
  lastInputTokens?: number
  effectiveContextTokens?: number
  countTurn?: boolean
}

type MetaPatch = Partial<
  Pick<
    Session,
    | "title"
    | "provider"
    | "model"
    | "workspacePath"
    | "workspaceReadOnly"
    | "reasoningEffort"
    | "nativeAgent"
    | "permission"
  >
>

type WorkspaceFiles = {
  openFiles: string[]
  activeFile: string | null
  previewFile: string | null
}

type SessionsState = {
  index: SessionMeta[]
  projects: string[]
  projectMeta: Record<string, ProjectMeta>
  activeId: string | null
  sessions: Record<string, Session>
  active: Session | null
  streamingIds: Record<string, true>
  compactingIds: Record<string, true>
  queued: Record<string, string[]>
  loaded: boolean
  isDraft: boolean
  loadingMsgId: string | null
  wsFiles: Record<string, WorkspaceFiles>
  msgWindow: Record<string, { oldestIdx: number; hasOlder: boolean }>

  loadAll: () => Promise<void>

  listRoutineRuns: (routineId: string) => Promise<SessionMeta[]>

  create: (
    provider: ProviderId,
    model: string,
    workspacePath?: string,
    reasoningEffort?: ReasoningEffort,
    routineId?: string,
  ) => Promise<string>

  lastSessionContext: (fallback: NewSessionContext) => Promise<NewSessionContext>

  addProject: (path: string) => Promise<void>

  removeProject: (path: string) => Promise<void>

  setProjectsOrder: (paths: string[]) => Promise<void>

  setProjectMeta: (path: string, patch: ProjectMeta) => Promise<void>

  relinkProject: (oldPath: string, newPath: string) => Promise<void>

  createDraft: (
    provider: ProviderId,
    model: string,
    workspacePath?: string,
    reasoningEffort?: ReasoningEffort,
  ) => string

  commitDraft: () => Promise<void>

  createDetached: (
    provider: ProviderId,
    model: string,
    workspacePath?: string,
    reasoningEffort?: ReasoningEffort,
  ) => string

  commitDetached: (id: string) => Promise<void>

  dropDetached: (id: string) => void

  open: (id: string) => Promise<void>

  loadIntoPool: (id: string) => Promise<void>

  setStreamingFor: (id: string, on: boolean) => void

  setCompactingFor: (id: string, on: boolean) => void

  enqueueMessage: (id: string, text: string) => void
  dequeueMessage: (id: string) => string | undefined
  removeQueuedAt: (id: string, idx: number) => void


  pushMessage: (msg: Message) => void
  pushMessageFor: (sessionId: string, msg: Message) => void

  patchMessage: (id: string, patch: Partial<Message>) => void
  patchMessageFor: (sessionId: string, id: string, patch: Partial<Message>) => void
  deleteMessageFor: (sessionId: string, id: string) => void

  updateActiveMeta: (patch: MetaPatch) => void
  updateMetaFor: (sessionId: string, patch: MetaPatch) => void

  appendModelMessages: (newOnes: ModelMessage[]) => void
  appendModelMessagesFor: (sessionId: string, newOnes: ModelMessage[]) => void

  addUsage: (delta: UsageDelta) => void
  addUsageFor: (sessionId: string, delta: UsageDelta) => void

  replaceModelMessages: (msgs: ModelMessage[]) => void
  replaceModelMessagesFor: (sessionId: string, msgs: ModelMessage[]) => void

  setEffectiveContextTokens: (n: number) => void
  setEffectiveContextTokensFor: (sessionId: string, n: number) => void

  forkAt: (messageId: string) => Promise<string>

  patchSessionMeta: (id: string, patch: SessionColumnPatch) => Promise<void>

  forkSession: (id: string) => Promise<string>

  forkSessionBackground: (id: string) => Promise<string>

  deleteMessage: (id: string) => void

  clearMessages: () => void

  // delete yapmaz.
  loadOlderMessages: (sessionId: string) => Promise<number>

  editMessage: (id: string, content: string) => void

  truncateAfter: (messageId: string) => void

  openFile: (path: string, opts?: { preview?: boolean }) => void
  pinPreviewFile: () => void
  closeFile: (path: string) => void
  closeAllFiles: () => void
  setActiveFile: (path: string | null) => void
  reorderOpenFiles: (fromPath: string, toPath: string) => void

  setMode: (mode: AgentMode) => void
  setModeFor: (sessionId: string, mode: AgentMode) => void

  setTodos: (todos: TodoItem[]) => void
  setTodosFor: (sessionId: string, todos: TodoItem[]) => void

  // Hepsi sid-bound (panel arka session'a da yazabilir); data blob'a persist olur.
  addSideChatFor: (sessionId: string, thread: SideChatThread) => void
  pushSideChatMsgFor: (sessionId: string, threadId: string, msg: SideChatMessage) => void
  patchSideChatMsgFor: (
    sessionId: string,
    threadId: string,
    idx: number,
    patch: Partial<SideChatMessage>,
  ) => void
  removeSideChatFor: (sessionId: string, threadId: string) => void

  setOrchestra: (cfg: OrchestraConfig | undefined) => void

  setHandleFor: (sessionId: string, handle: string | undefined) => void

  setGoal: (text: string, maxIter?: number) => void
  setGoalFor: (sessionId: string, text: string, maxIter?: number) => void

  clearGoal: () => void
  clearGoalFor: (sessionId: string) => void

  incGoalIter: () => void
  incGoalIterFor: (sessionId: string) => void

  pauseGoal: () => void
  pauseGoalFor: (sessionId: string) => void
  resumeGoal: () => void
  resumeGoalFor: (sessionId: string) => void

  editGoalText: (text: string) => void
  editGoalTextFor: (sessionId: string, text: string) => void

  patchAgentCard: (messageId: string, workerId: string, patch: Partial<AgentCardPart>) => void
  patchAgentCardFor: (
    sessionId: string,
    messageId: string,
    workerId: string,
    patch: Partial<AgentCardPart>,
  ) => void

  pushAgentCard: (messageId: string, card: AgentCardPart) => void
  pushAgentCardFor: (sessionId: string, messageId: string, card: AgentCardPart) => void

  appendAgentCardLog: (
    messageId: string,
    workerId: string,
    line: string,
    maxLines: number,
  ) => void
  appendAgentCardLogFor: (
    sessionId: string,
    messageId: string,
    workerId: string,
    line: string,
    maxLines: number,
  ) => void

  appendAgentCardFinalTextFor: (
    sessionId: string,
    messageId: string,
    workerId: string,
    delta: string,
  ) => void

  setSnapshotBaseFor: (sessionId: string, messageId: string, base: string) => void

  revertToBeforeMessage: (
    messageId: string,
  ) => Promise<{ restored: number; deleted: number; canUndo: boolean }>

  revertTurnFile: (messageId: string, path: string) => Promise<boolean>

  revertTurnHunk: (messageId: string, path: string, hunkIndex: number) => Promise<boolean>

  turnFileDiff: (messageId: string, path: string) => Promise<DiffLine[] | null>

  unrevertSession: (sessionId?: string) => Promise<{ restored: number; deleted: number } | null>

  persistActive: () => Promise<void>
  persistSession: (id: string) => Promise<void>
  persistAllPending: () => Promise<void>

  // Sessionu sil
  remove: (id: string) => Promise<void>

  clear: () => Promise<void>
}

function metaOf(s: Session): SessionMeta {
  const m: SessionMeta = {
    id: s.id,
    title: s.title,
    updatedAt: s.updatedAt,
    workspacePath: s.workspacePath,
  }
  if (s.pinned) m.pinned = true
  if (s.unread) m.unread = true
  if (s.archived) m.archived = true
  if (s.forkParentId) m.forkParentId = s.forkParentId
  if (s.routineId) m.routineId = s.routineId
  return m
}

function autoTitleFromMessages(msgs: Message[]): string {
  const firstUser = msgs.find((m) => m.role === "user" && !m.meta)
  if (!firstUser) return tStatic("commandPalette.newChat")
  const text = firstUser.content.trim().replace(/\s+/g, " ")
  return text.length > 60 ? text.slice(0, 57) + "..." : text || tStatic("commandPalette.newChat")
}

function modelBoundary(messages: Message[], uiLen: number): number | null {
  let sum = 0
  for (let i = 0; i < uiLen; i++) {
    const m = messages[i]
    const c = m?.modelMsgCount
    if (c == null) {
      if (m?.role === "system") continue
      return null
    }
    sum += c
  }
  return sum
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const loadingOlderSids = new Set<string>()
const seqOf = new Map<string, number>()
const lastFlushAt = new Map<string, number>()
const MAX_FLUSH_WAIT = 3000

// Son revert'in geri-al verisi (RAM-only, per-session). revertToBeforeMessage
type RevertUndo = {
  redoSnapshot: string
  messages: Message[]
  modelTail: ModelMessage[]
  baseLen: number
  baseModelLen: number
}
const revertUndo = new Map<string, RevertUndo>()

function diffFrom<T>(before: T[], after: T[]): number {
  let i = 0
  const n = Math.min(before.length, after.length)
  while (i < n && JSON.stringify(before[i]) === JSON.stringify(after[i])) i++
  return i
}

const EMPTY_FILES: WorkspaceFiles = { openFiles: [], activeFile: null, previewFile: null }

const MSG_PAGE = 200

function filesKeyOf(s: Pick<Session, "id" | "workspacePath">): string {
  return s.workspacePath || `ses:${s.id}`
}

const WS_FILES_LS_KEY = "codezal.wsFiles"

function loadWsFiles(): Record<string, WorkspaceFiles> {
  try {
    const raw = localStorage.getItem(WS_FILES_LS_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Record<string, Partial<WorkspaceFiles>>
    const out: Record<string, WorkspaceFiles> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v && Array.isArray(v.openFiles)) {
        out[k] = {
          openFiles: v.openFiles.filter((p): p is string => typeof p === "string"),
          activeFile: typeof v.activeFile === "string" ? v.activeFile : null,
          previewFile: typeof v.previewFile === "string" ? v.previewFile : null,
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

const WS_FILES_CAP = 120

function saveWsFiles(map: Record<string, WorkspaceFiles>): void {
  try {
    let keys = Object.keys(map).filter((k) => !k.startsWith("ses:"))
    if (keys.length > WS_FILES_CAP) keys = keys.slice(keys.length - WS_FILES_CAP)
    const persistable: Record<string, WorkspaceFiles> = {}
    for (const k of keys) persistable[k] = map[k]!
    localStorage.setItem(WS_FILES_LS_KEY, JSON.stringify(persistable))
  } catch {
    // Intentionally ignored.
  }
}

let wsFilesSaveTimer: ReturnType<typeof setTimeout> | null = null
let wsFilesPending: Record<string, WorkspaceFiles> | null = null
function scheduleSaveWsFiles(map: Record<string, WorkspaceFiles>): void {
  wsFilesPending = map
  if (wsFilesSaveTimer) return
  wsFilesSaveTimer = setTimeout(() => {
    wsFilesSaveTimer = null
    const m = wsFilesPending
    wsFilesPending = null
    if (m) saveWsFiles(m)
  }, 400)
}
function flushWsFiles(): void {
  if (wsFilesSaveTimer) {
    clearTimeout(wsFilesSaveTimer)
    wsFilesSaveTimer = null
  }
  const m = wsFilesPending
  wsFilesPending = null
  if (m) saveWsFiles(m)
}

export const useSessionsStore = create<SessionsState>((set, get): SessionsState => {
  const shadowMsgs = new Map<string, Message[]>()
  const shadowParts = new Map<string, Map<string, Part[]>>()
  const shadowModelMsgs = new Map<string, ModelMessage[]>()
  const seen = new Set<string>()
  const touchSeen = (id: string): void => {
    seen.delete(id)
    seen.add(id)
  }

  const setShadow = (sid: string, msgs: Message[], modelMsgs: ModelMessage[] = []): void => {
    shadowMsgs.set(sid, msgs)
    const pm = new Map<string, Part[]>()
    for (const m of msgs) pm.set(m.id, m.parts ?? [])
    shadowParts.set(sid, pm)
    shadowModelMsgs.set(sid, modelMsgs)
  }
  const dropShadow = (sid: string): void => {
    shadowMsgs.delete(sid)
    shadowParts.delete(sid)
    shadowModelMsgs.delete(sid)
    seqOf.delete(sid)
    lastFlushAt.delete(sid)
    revertUndo.delete(sid)
  }

  const flush = async (sid: string): Promise<void> => {
    await withLock(`db-session:${sid}`, async () => {
      const s = get().sessions[sid]
      if (!s) return
      if (!get().index.some((m) => m.id === sid)) return
      const prevMsgs = shadowMsgs.get(sid) ?? []
      const pm = shadowParts.get(sid) ?? new Map<string, Part[]>()
      const curIds = new Set(s.messages.map((m) => m.id))
      const prevById = new Map(prevMsgs.map((m) => [m.id, m]))
      let seq = seqOf.get(sid) ?? 0
      const prevMM = shadowModelMsgs.get(sid) ?? []
      const curMM = s.modelMessages ?? []

      await db.tx(async (t) => {
        await upsertSessionRow(t, s)
        for (const m of prevMsgs) {
          if (!curIds.has(m.id)) await dbDeleteMessage(t, sid, m.id)
        }
        for (const m of s.messages) {
          const prev = prevById.get(m.id)
          if (!prev) {
            await insertMessageInto(t, sid, seq++, m)
            pm.set(m.id, m.parts ?? [])
          } else if (prev !== m) {
            await updateMessageRow(t, sid, m)
            const before = pm.get(m.id) ?? prev.parts ?? []
            const after = m.parts ?? []
            await persistParts(t, sid, m.id, after, diffFrom(before, after))
            pm.set(m.id, after)
          }
        }
        await persistModelMessages(t, sid, curMM, diffFrom(prevMM, curMM))
      })

      seqOf.set(sid, seq)
      shadowMsgs.set(sid, s.messages)
      shadowParts.set(sid, pm)
      shadowModelMsgs.set(sid, curMM)
      lastFlushAt.set(sid, Date.now())
    })
  }

  const scheduleFlush = (id: string): void => {
    if (get().isDraft && get().activeId === id) return
    const prev = persistTimers.get(id)
    if (prev) clearTimeout(prev)
    const last = lastFlushAt.get(id)
    if (last === undefined) {
      lastFlushAt.set(id, Date.now())
    } else if (Date.now() - last >= MAX_FLUSH_WAIT) {
      persistTimers.delete(id)
      void flush(id)
      return
    }
    persistTimers.set(
      id,
      setTimeout(() => {
        persistTimers.delete(id)
        void flush(id)
      }, 600),
    )
  }

  const flushSession = async (id: string | null): Promise<void> => {
    if (!id) return
    const t = persistTimers.get(id)
    if (t) {
      clearTimeout(t)
      persistTimers.delete(id)
    }
    if (get().isDraft && get().activeId === id) return
    await flush(id)
  }

  const flushPending = (): void => {
    for (const [id, t] of persistTimers) {
      clearTimeout(t)
      void flush(id).catch(() => {})
    }
    persistTimers.clear()
  }
  const flushAllPending = async (): Promise<void> => {
    const ids = [...persistTimers.keys()]
    for (const t of persistTimers.values()) clearTimeout(t)
    persistTimers.clear()
    await Promise.all(ids.map((id) => flush(id).catch(() => {})))
  }

  const evictIdle = async (): Promise<void> => {
    const st = get()
    const poolKeys = Object.keys(st.sessions)
    if (poolKeys.length <= MAX_HYDRATED_SESSIONS) return

    const plan = planSessionEviction({
      poolKeys,
      seenOrder: [...seen],
      activeId: st.activeId,
      streamingIds: Object.keys(st.streamingIds),
      pinnedIds: st.index.filter((m) => m.pinned).map((m) => m.id),
      isDraft: st.isDraft,
      limit: MAX_HYDRATED_SESSIONS,
      indexIds: st.index.map((m) => m.id),
    })
    seen.clear()
    for (const id of plan.order) seen.add(id)
    if (plan.stale.length === 0) return

    const toEvict: string[] = []
    for (const id of plan.stale) {
      await flushSession(id)
      const s = get()
      if (id === s.activeId || s.streamingIds[id]) continue
      toEvict.push(id)
    }
    if (toEvict.length === 0) return

    for (const id of toEvict) {
      dropShadow(id)
      seen.delete(id)
    }
    set((s) => {
      const sessions = { ...s.sessions }
      for (const id of toEvict) delete sessions[id]
      return { sessions }
    })
  }
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flushPending)
    window.addEventListener("beforeunload", flushWsFiles)
  }

  const mut = (id: string, recipe: (s: Session) => Session): void => {
    const cur = get().sessions[id]
    if (!cur) return
    const next = recipe(cur)
    if (next === cur) return
    set((st) => ({
      sessions: { ...st.sessions, [id]: next },
      active: st.activeId === id ? next : st.active,
    }))
    scheduleFlush(id)
  }

  const mutActive = (recipe: (s: Session) => Session): void => {
    const id = get().activeId
    if (id) mut(id, recipe)
  }

  const setActiveFilesMirror = (f: WorkspaceFiles): void => {
    const id = get().activeId
    if (!id) return
    set((st) => {
      const cur = st.sessions[id]
      if (!cur) return {}
      const next: Session = {
        ...cur,
        openFiles: f.openFiles,
        activeFile: f.activeFile,
        previewFile: f.previewFile,
      }
      return {
        sessions: { ...st.sessions, [id]: next },
        active: st.activeId === id ? next : st.active,
      }
    })
  }

  const ensureFilesHydrated = (s: Session): void => {
    const key = filesKeyOf(s)
    if (!get().wsFiles[key]) {
      const seed: WorkspaceFiles = {
        openFiles: s.openFiles ?? [],
        activeFile: s.activeFile ?? null,
        previewFile: s.previewFile ?? null,
      }
      set((st) => ({ wsFiles: { ...st.wsFiles, [key]: seed } }))
      saveWsFiles(get().wsFiles)
    }
    setActiveFilesMirror(get().wsFiles[key] ?? EMPTY_FILES)
  }

  const mutFiles = (recipe: (f: WorkspaceFiles) => WorkspaceFiles): void => {
    const a = get().active
    if (!a) return
    const key = filesKeyOf(a)
    const cur = get().wsFiles[key] ?? EMPTY_FILES
    const next = recipe(cur)
    if (next === cur) return
    set((st) => ({ wsFiles: { ...st.wsFiles, [key]: next } }))
    scheduleSaveWsFiles(get().wsFiles)
    setActiveFilesMirror(next)
  }

  return {
    index: [],
    projects: [],
    projectMeta: {},
    activeId: null,
    sessions: {},
    active: null,
    streamingIds: {},
    compactingIds: {},
    queued: {},
    loaded: false,
    isDraft: false,
    loadingMsgId: null,
    wsFiles: loadWsFiles(),
    msgWindow: {},

    loadAll: async () => {
      try {
        await bootstrapDb()
        const metas = await listSessionMetas(db) // updated_at DESC zaten
        const projectRows = await listProjects(db) // sort ASC
        const projects = projectRows.map((p) => p.path)
        const projectMeta: Record<string, ProjectMeta> = {}
        for (const p of projectRows) if (Object.keys(p.meta).length > 0) projectMeta[p.path] = p.meta
        // Session workspace'lerini de registry'ye kat — projenin son sohbeti silinse
        const known = new Set(projects)
        for (const m of metas) {
          if (m.workspacePath && !known.has(m.workspacePath)) {
            known.add(m.workspacePath)
            projects.push(m.workspacePath)
          }
        }
        set({ index: metas, loaded: true, projects, projectMeta })
      } catch (e) {
        console.error("[sessions] DB başlatılamadı, in-memory moda düşülüyor:", e)
        set({ index: [], loaded: true, projects: [], projectMeta: {} })
        throw e
      }
    },

    listRoutineRuns: async (routineId) => {
      try {
        return await listSessionsByRoutineId(db, routineId)
      } catch (e) {
        console.warn(`[sessions] routine runs query failed for '${routineId}':`, e)
        return []
      }
    },

    create: async (provider, model, workspacePath, reasoningEffort, routineId) => {
      const s = makeEmptySession(provider, model, workspacePath, reasoningEffort, routineId)
      await upsertSessionRow(db, s)
      let projects = get().projects
      if (workspacePath && !projects.includes(workspacePath)) {
        await upsertProject(db, workspacePath, get().projectMeta[workspacePath] ?? {}, projects.length)
        projects = [...projects, workspacePath]
      }
      setShadow(s.id, [])
      seqOf.set(s.id, 0)
      set((st) => ({
        index: [metaOf(s), ...st.index],
        projects,
        sessions: { ...st.sessions, [s.id]: s },
        activeId: s.id,
        active: s,
        isDraft: false,
      }))
      ensureFilesHydrated(s)
      touchSeen(s.id)
      void evictIdle().catch(() => {})
      return s.id
    },

    lastSessionContext: async (fallback) => {
      const st = get()
      let last: Session | null = st.active
      if (!last) {
        const top = st.index[0]
        if (top) last = st.sessions[top.id] ?? (await loadSessionScalar(db, top.id))
      }
      if (!last) return { ...fallback }
      const ctx: NewSessionContext = { provider: last.provider, model: last.model }
      if (last.reasoningEffort) ctx.reasoningEffort = last.reasoningEffort
      if (last.workspacePath) ctx.workspacePath = last.workspacePath
      return ctx
    },

    createDraft: (provider, model, workspacePath, reasoningEffort) => {
      const s = makeEmptySession(provider, model, workspacePath, reasoningEffort)
      set((st) => ({
        sessions: { ...st.sessions, [s.id]: s },
        active: s,
        activeId: s.id,
        isDraft: true,
      }))
      ensureFilesHydrated(s)
      return s.id
    },

    commitDraft: async () => {
      if (!get().isDraft) return
      const a = get().active
      if (!a) return
      let projects = get().projects
      let projectMeta = get().projectMeta
      if (a.workspacePath) {
        const merged: ProjectMeta = {
          ...projectMeta[a.workspacePath],
          defaultProvider: a.provider,
          defaultModel: a.model,
        }
        const sort = projects.indexOf(a.workspacePath)
        await upsertProject(db, a.workspacePath, merged, sort < 0 ? projects.length : sort)
        if (!projects.includes(a.workspacePath)) projects = [...projects, a.workspacePath]
        projectMeta = { ...projectMeta, [a.workspacePath]: merged }
      }
      setShadow(a.id, [])
      seqOf.set(a.id, 0)
      set((st) => ({ index: [metaOf(a), ...st.index], projects, projectMeta, isDraft: false }))
      await flush(a.id)
    },

    createDetached: (provider, model, workspacePath, reasoningEffort) => {
      const s = makeEmptySession(provider, model, workspacePath, reasoningEffort)
      set((st) => ({ sessions: { ...st.sessions, [s.id]: s } }))
      touchSeen(s.id)
      return s.id
    },

    commitDetached: async (id) => {
      const s = get().sessions[id]
      if (!s) return
      if (get().index.some((m) => m.id === id)) return
      let projects = get().projects
      if (s.workspacePath && !projects.includes(s.workspacePath)) {
        await upsertProject(db, s.workspacePath, get().projectMeta[s.workspacePath] ?? {}, projects.length)
        projects = [...projects, s.workspacePath]
      }
      setShadow(id, [])
      seqOf.set(id, 0)
      set((st) => ({ index: [metaOf(s), ...st.index], projects }))
      try {
        await flush(id)
      } catch (e) {
        set((st) => ({ index: st.index.filter((m) => m.id !== id) }))
        dropShadow(id)
        throw e
      }
    },

    dropDetached: (id) => {
      if (get().index.some((m) => m.id === id)) return
      const s = get().sessions[id]
      if (!s || s.messages.length > 0) return
      dropShadow(id)
      seen.delete(id)
      set((st) => {
        const sessions = { ...st.sessions }
        delete sessions[id]
        return { sessions }
      })
    },

    open: async (id) => {
      const st0 = get()
      if (st0.activeId === id) return
      const prevId = st0.activeId
      const prevWasDraft = st0.isDraft
      await flushSession(prevId)
      let target = get().sessions[id]
      const needsLoad = !target
      if (!target) {
        const scalar = await loadSessionScalar(db, id)
        if (!scalar) return
        target = { ...scalar, messages: [], modelMessages: [] }
      }
      const targetSession = target
      const filesKey = filesKeyOf(targetSession)
      const hadFiles = !!get().wsFiles[filesKey]
      set((st) => {
        const files = st.wsFiles[filesKey] ?? {
          openFiles: targetSession.openFiles ?? [],
          activeFile: targetSession.activeFile ?? null,
          previewFile: targetSession.previewFile ?? null,
        }
        const hydrated: Session = {
          ...targetSession,
          openFiles: files.openFiles,
          activeFile: files.activeFile,
          previewFile: files.previewFile,
        }
        const sessions = { ...st.sessions, [id]: hydrated }
        if (prevWasDraft && prevId && prevId !== id) delete sessions[prevId]
        return {
          sessions,
          activeId: id,
          active: hydrated,
          isDraft: false,
          loadingMsgId: needsLoad ? id : st.loadingMsgId,
          wsFiles: st.wsFiles[filesKey] ? st.wsFiles : { ...st.wsFiles, [filesKey]: files },
        }
      })
      if (!hadFiles) saveWsFiles(get().wsFiles)
      if (targetSession.unread || get().index.find((m) => m.id === id)?.unread) {
        await get().patchSessionMeta(id, { unread: false })
      }
      touchSeen(id)
      void evictIdle().catch(() => {})
      if (needsLoad) {
        const page = await loadMessagesPage(db, id, { limit: MSG_PAGE })
        const modelMsgs = await loadModelMessages(db, id)
        setShadow(id, page.messages, modelMsgs)
        seqOf.set(id, await nextMessageSeq(db, id))
        const loadedWindow = { oldestIdx: page.oldestIdx ?? 0, hasOlder: page.hasOlder }
        set((st) => {
          const cur = st.sessions[id]
          if (!cur) return {} // arada evict/silindi → dokunma
          const updated: Session = { ...cur, messages: page.messages, modelMessages: modelMsgs }
          return {
            sessions: { ...st.sessions, [id]: updated },
            active: st.activeId === id ? updated : st.active,
            loadingMsgId: st.loadingMsgId === id ? null : st.loadingMsgId,
            msgWindow: { ...st.msgWindow, [id]: loadedWindow },
          }
        })
      }
    },

    loadIntoPool: async (id) => {
      if (get().sessions[id]) return
      const scalar = await loadSessionScalar(db, id)
      if (!scalar) return
      const page = await loadMessagesPage(db, id, { limit: MSG_PAGE })
      const modelMsgs = await loadModelMessages(db, id)
      const target: Session = { ...scalar, messages: page.messages, modelMessages: modelMsgs }
      setShadow(id, page.messages, modelMsgs)
      seqOf.set(id, await nextMessageSeq(db, id))
      set((st) => ({
        sessions: { ...st.sessions, [id]: target },
        msgWindow: { ...st.msgWindow, [id]: { oldestIdx: page.oldestIdx ?? 0, hasOlder: page.hasOlder } },
      }))
      touchSeen(id)
    },

    setStreamingFor: (id, on) => {
      set((st) => {
        const cur = st.streamingIds
        if (on === !!cur[id]) return st
        const next = { ...cur }
        if (on) next[id] = true
        else delete next[id]
        return { streamingIds: next }
      })
    },

    setCompactingFor: (id, on) => {
      set((st) => {
        const cur = st.compactingIds
        if (on === !!cur[id]) return st
        const next = { ...cur }
        if (on) next[id] = true
        else delete next[id]
        return { compactingIds: next }
      })
    },

    enqueueMessage: (id, text) => {
      set((st) => ({ queued: { ...st.queued, [id]: [...(st.queued[id] ?? []), text] } }))
    },
    dequeueMessage: (id) => {
      const cur = get().queued[id] ?? []
      if (cur.length === 0) return undefined
      const [head, ...rest] = cur
      set((st) => {
        const next = { ...st.queued }
        if (rest.length) next[id] = rest
        else delete next[id]
        return { queued: next }
      })
      return head
    },
    removeQueuedAt: (id, idx) => {
      set((st) => {
        const cur = st.queued[id]
        if (!cur || idx < 0 || idx >= cur.length) return st
        const arr = cur.filter((_, i) => i !== idx)
        const next = { ...st.queued }
        if (arr.length) next[id] = arr
        else delete next[id]
        return { queued: next }
      })
    },

    pushMessageFor: (sessionId, msg) => {
      let newTitle: string | null = null
      mut(sessionId, (s) => {
        const next: Session = {
          ...s,
          messages: [...s.messages, msg],
          updatedAt: Date.now(),
        }
        if (next.title === tStatic("commandPalette.newChat")) {
          next.title = autoTitleFromMessages(next.messages)
          if (next.title !== s.title) newTitle = next.title
        }
        return next
      })
      if (newTitle !== null) {
        set((st) => ({
          index: st.index.map((m) => (m.id === sessionId ? { ...m, title: newTitle! } : m)),
        }))
      }
    },
    pushMessage: (msg) => {
      const id = get().activeId
      if (id) get().pushMessageFor(id, msg)
    },

    patchMessageFor: (sessionId, id, patch) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== id) return m
          if (patch.parts && m.parts) {
            const existingCards = m.parts.filter((p) => p.type === "agent-card")
            if (existingCards.length > 0) {
              const incomingHasCards = patch.parts.some((p) => p.type === "agent-card")
              if (!incomingHasCards) {
                return { ...m, ...patch, parts: [...patch.parts, ...existingCards] }
              }
            }
          }
          return { ...m, ...patch }
        }),
        updatedAt: Date.now(),
      })),
    patchMessage: (id, patch) => {
      const sid = get().activeId
      if (sid) get().patchMessageFor(sid, id, patch)
    },

    deleteMessageFor: (sessionId, id) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== id),
        updatedAt: Date.now(),
      })),

    updateMetaFor: (sessionId, patch) =>
      mut(sessionId, (s) => ({ ...s, ...patch, updatedAt: Date.now() })),
    updateActiveMeta: (patch) => {
      const id = get().activeId
      if (id) get().updateMetaFor(id, patch)
    },

    appendModelMessagesFor: (sessionId, newOnes) =>
      mut(sessionId, (s) => ({
        ...s,
        modelMessages: [...(s.modelMessages ?? []), ...newOnes],
        updatedAt: Date.now(),
      })),
    appendModelMessages: (newOnes) => {
      const id = get().activeId
      if (id) get().appendModelMessagesFor(id, newOnes)
    },

    addUsageFor: (sessionId, delta) =>
      mut(sessionId, (s) => {
        const cur = s.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          turns: 0,
        }
        return {
          ...s,
          usage: {
            inputTokens: cur.inputTokens + delta.inputTokens,
            outputTokens: cur.outputTokens + delta.outputTokens,
            cacheReadTokens: (cur.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
            cacheWriteTokens: (cur.cacheWriteTokens ?? 0) + (delta.cacheWriteTokens ?? 0),
            reasoningTokens: (cur.reasoningTokens ?? 0) + (delta.reasoningTokens ?? 0),
            costUsd: cur.costUsd + delta.costUsd,
            turns: cur.turns + (delta.countTurn === false ? 0 : 1),
            lastInputTokens: delta.lastInputTokens ?? delta.inputTokens,
            effectiveContextTokens: delta.effectiveContextTokens ?? cur.effectiveContextTokens,
          },
          updatedAt: Date.now(),
        }
      }),
    addUsage: (delta) => {
      const id = get().activeId
      if (id) get().addUsageFor(id, delta)
    },

    replaceModelMessagesFor: (sessionId, msgs) =>
      mut(sessionId, (s) => ({ ...s, modelMessages: msgs, updatedAt: Date.now() })),
    replaceModelMessages: (msgs) => {
      const id = get().activeId
      if (id) get().replaceModelMessagesFor(id, msgs)
    },

    setEffectiveContextTokensFor: (sessionId, n) =>
      mut(sessionId, (s) => {
        const cur = s.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          turns: 0,
        }
        return { ...s, usage: { ...cur, effectiveContextTokens: n }, updatedAt: Date.now() }
      }),
    setEffectiveContextTokens: (n) => {
      const id = get().activeId
      if (id) get().setEffectiveContextTokensFor(id, n)
    },

    openFile: (path, opts) =>
      mutFiles((f) => {
        const open = f.openFiles
        const prevPreview = f.previewFile
        const wantPreview = !!opts?.preview
        const alreadyOpen = open.includes(path)

        if (alreadyOpen) {
          if (path === prevPreview && !wantPreview) {
            return { ...f, activeFile: path, previewFile: null }
          }
          return { ...f, activeFile: path }
        }

        if (wantPreview) {
          const filtered = prevPreview ? open.filter((p) => p !== prevPreview) : open
          return { openFiles: [...filtered, path], activeFile: path, previewFile: path }
        }

        return { ...f, openFiles: [...open, path], activeFile: path }
      }),

    pinPreviewFile: () =>
      mutFiles((f) => (f.previewFile ? { ...f, previewFile: null } : f)),

    closeFile: (path) => {
      clearDirty(path)
      clearDraft(path)
      mutFiles((f) => {
        const open = f.openFiles
        const idx = open.indexOf(path)
        if (idx === -1) return f
        const next = open.filter((p) => p !== path)
        let activeFile = f.activeFile
        if (activeFile === path) {
          activeFile = next[idx] ?? next[idx - 1] ?? null
        }
        const previewFile = f.previewFile === path ? null : f.previewFile
        return { openFiles: next, activeFile, previewFile }
      })
    },

    closeAllFiles: () => {
      const a = get().active
      if (!a) return
      const open = get().wsFiles[filesKeyOf(a)]?.openFiles ?? []
      if (open.length === 0) return
      for (const p of open) {
        clearDirty(p)
        clearDraft(p)
      }
      mutFiles(() => ({ openFiles: [], activeFile: null, previewFile: null }))
    },

    setActiveFile: (path) =>
      mutFiles((f) => (f.activeFile === path ? f : { ...f, activeFile: path })),

    reorderOpenFiles: (fromPath, toPath) =>
      mutFiles((f) => {
        const open = f.openFiles
        const from = open.indexOf(fromPath)
        const to = open.indexOf(toPath)
        if (from === -1 || to === -1 || from === to) return f
        const next = open.slice()
        const [moved] = next.splice(from, 1)
        next.splice(next.indexOf(toPath) + (from < to ? 1 : 0), 0, moved!)
        return { ...f, openFiles: next }
      }),

    setMode: (mode) => mutActive((s) => ({ ...s, mode, updatedAt: Date.now() })),
    setModeFor: (sessionId, mode) => mut(sessionId, (s) => ({ ...s, mode, updatedAt: Date.now() })),

    setTodosFor: (sessionId, todos) =>
      mut(sessionId, (s) => ({ ...s, todos, updatedAt: Date.now() })),
    setTodos: (todos) => {
      const id = get().activeId
      if (id) get().setTodosFor(id, todos)
    },

    addSideChatFor: (sessionId, thread) =>
      mut(sessionId, (s) => ({
        ...s,
        sideChats: [...(s.sideChats ?? []), thread],
        updatedAt: Date.now(),
      })),
    pushSideChatMsgFor: (sessionId, threadId, msg) =>
      mut(sessionId, (s) => {
        const chats = s.sideChats
        if (!chats) return s
        const next = chats.map((t) =>
          t.id === threadId ? { ...t, messages: [...t.messages, msg] } : t,
        )
        return { ...s, sideChats: next, updatedAt: Date.now() }
      }),
    patchSideChatMsgFor: (sessionId, threadId, idx, patch) =>
      mut(sessionId, (s) => {
        const chats = s.sideChats
        if (!chats) return s
        const next = chats.map((t) => {
          if (t.id !== threadId) return t
          const msgs = t.messages.slice()
          const cur = msgs[idx]
          if (!cur) return t
          msgs[idx] = { ...cur, ...patch }
          return { ...t, messages: msgs }
        })
        return { ...s, sideChats: next }
      }),
    removeSideChatFor: (sessionId, threadId) =>
      mut(sessionId, (s) => {
        const chats = s.sideChats
        if (!chats) return s
        const next = chats.filter((t) => t.id !== threadId)
        return { ...s, sideChats: next, updatedAt: Date.now() }
      }),

    setOrchestra: (cfg) => mutActive((s) => ({ ...s, orchestra: cfg, updatedAt: Date.now() })),

    setHandleFor: (sessionId, handle) => {
      const norm = handle && handle.trim() ? handle.trim() : undefined
      mut(sessionId, (s) => {
        if ((s.handle ?? undefined) === norm) return s
        const next = { ...s } as Session
        if (norm) next.handle = norm
        else delete next.handle
        return next
      })
      set((st) => ({
        index: st.index.map((m) => {
          if (m.id !== sessionId) return m
          const nm = { ...m } as SessionMeta
          if (norm) nm.handle = norm
          else delete nm.handle
          return nm
        }),
      }))
    },

    setGoalFor: (sessionId, text, maxIter = 30) =>
      mut(sessionId, (s) => {
        const goal: SessionGoal = {
          text: text.trim(),
          iter: 0,
          maxIter,
          createdAt: Date.now(),
        }
        return { ...s, goal, updatedAt: Date.now() }
      }),
    setGoal: (text, maxIter = 30) => {
      const id = get().activeId
      if (id) get().setGoalFor(id, text, maxIter)
    },

    clearGoalFor: (sessionId) =>
      mut(sessionId, (s) => {
        if (!s.goal) return s
        const next = { ...s, updatedAt: Date.now() } as Session
        delete next.goal
        return next
      }),
    clearGoal: () => {
      const id = get().activeId
      if (id) get().clearGoalFor(id)
    },

    incGoalIterFor: (sessionId) =>
      mut(sessionId, (s) =>
        s.goal
          ? { ...s, goal: { ...s.goal, iter: s.goal.iter + 1 }, updatedAt: Date.now() }
          : s,
      ),
    incGoalIter: () => {
      const id = get().activeId
      if (id) get().incGoalIterFor(id)
    },

    pauseGoalFor: (sessionId) =>
      mut(sessionId, (s) =>
        s.goal && !s.goal.paused
          ? { ...s, goal: { ...s.goal, paused: true }, updatedAt: Date.now() }
          : s,
      ),
    pauseGoal: () => {
      const id = get().activeId
      if (id) get().pauseGoalFor(id)
    },
    resumeGoalFor: (sessionId) =>
      mut(sessionId, (s) =>
        s.goal?.paused
          ? { ...s, goal: { ...s.goal, paused: false }, updatedAt: Date.now() }
          : s,
      ),
    resumeGoal: () => {
      const id = get().activeId
      if (id) get().resumeGoalFor(id)
    },

    editGoalTextFor: (sessionId, text) =>
      mut(sessionId, (s) =>
        s.goal
          ? { ...s, goal: { ...s.goal, text: text.trim() }, updatedAt: Date.now() }
          : s,
      ),
    editGoalText: (text) => {
      const id = get().activeId
      if (id) get().editGoalTextFor(id, text)
    },

    patchAgentCardFor: (sessionId, messageId, workerId, patch) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== messageId || !m.parts) return m
          return {
            ...m,
            parts: m.parts.map((p) => {
              if (p.type !== "agent-card" || p.workerId !== workerId) return p
              return { ...p, ...patch }
            }),
          }
        }),
        updatedAt: Date.now(),
      })),
    patchAgentCard: (messageId, workerId, patch) => {
      const id = get().activeId
      if (id) get().patchAgentCardFor(id, messageId, workerId, patch)
    },

    pushAgentCardFor: (sessionId, messageId, card) => {
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== messageId) return m
          const parts = m.parts ?? []
          if (parts.some((p) => p.type === "agent-card" && p.workerId === card.workerId)) {
            return m
          }
          return { ...m, parts: [...parts, card] }
        }),
        updatedAt: Date.now(),
      }))
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("codezal:agent-card-pushed"))
      }
    },
    pushAgentCard: (messageId, card) => {
      const id = get().activeId
      if (id) get().pushAgentCardFor(id, messageId, card)
    },

    appendAgentCardLogFor: (sessionId, messageId, workerId, line, maxLines) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== messageId || !m.parts) return m
          return {
            ...m,
            parts: m.parts.map((p) => {
              if (p.type !== "agent-card" || p.workerId !== workerId) return p
              const next = [...p.outputLog, line]
              const overflow = next.length - maxLines
              const trimmed = overflow > 0 ? next.slice(overflow) : next
              return { ...p, outputLog: trimmed }
            }),
          }
        }),
        updatedAt: Date.now(),
      })),
    appendAgentCardFinalTextFor: (sessionId, messageId, workerId, delta) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== messageId || !m.parts) return m
          return {
            ...m,
            parts: m.parts.map((p) => {
              if (p.type !== "agent-card" || p.workerId !== workerId) return p
              return { ...p, finalText: (p.finalText ?? "") + delta }
            }),
          }
        }),
        updatedAt: Date.now(),
      })),
    appendAgentCardLog: (messageId, workerId, line, maxLines) => {
      const id = get().activeId
      if (id) get().appendAgentCardLogFor(id, messageId, workerId, line, maxLines)
    },

    setSnapshotBaseFor: (sessionId, messageId, base) =>
      mut(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, snapshotBase: base } : m)),
        updatedAt: Date.now(),
      })),

    revertToBeforeMessage: async (messageId) => {
      const st = get()
      const aid = st.activeId
      const session = aid ? st.sessions[aid] : null
      if (!aid || !session) throw new Error("Aktif session yok")
      if (!session.workspacePath) throw new Error("Workspace bağlı değil — revert yapılamaz")
      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) throw new Error("Mesaj bulunamadı")

      const base = session.messages[idx]?.snapshotBase
      if (!base) throw new Error("Bu mesaj için snapshot yok — revert yapılamaz")

      const redo = await checkpoint(session.id, session.workspacePath)
      const cut = modelBoundary(session.messages, idx) ?? idx
      const removedMessages = session.messages.slice(idx)
      const removedModelTail = (session.modelMessages ?? []).slice(cut)

      const result = await revertToBase(session.id, session.workspacePath, base)

      mut(aid, (s) => ({
        ...s,
        messages: s.messages.slice(0, idx),
        modelMessages: (s.modelMessages ?? []).slice(0, cut),
        updatedAt: Date.now(),
      }))

      if (redo) {
        revertUndo.set(aid, {
          redoSnapshot: redo,
          messages: removedMessages,
          modelTail: removedModelTail,
          baseLen: idx,
          baseModelLen: cut,
        })
      } else {
        revertUndo.delete(aid)
      }
      return { ...result, canUndo: !!redo }
    },

    revertTurnFile: async (messageId, path) => {
      const st = get()
      const aid = st.activeId
      const session = aid ? st.sessions[aid] : null
      if (!aid || !session?.workspacePath) return false
      const base = session.messages.find((m) => m.id === messageId)?.snapshotBase
      if (!base) return false
      return revertFileToBase(session.id, session.workspacePath, base, path)
    },

    revertTurnHunk: async (messageId, path, hunkIndex) => {
      const st = get()
      const aid = st.activeId
      const session = aid ? st.sessions[aid] : null
      if (!aid || !session?.workspacePath) return false
      const base = session.messages.find((m) => m.id === messageId)?.snapshotBase
      if (!base) return false
      const baseContent = await fileAtBase(session.id, session.workspacePath, base, path)
      if (baseContent == null) return false
      let abs: string
      try {
        abs = resolveInWorkspace(session.workspacePath, path)
      } catch {
        return false
      }
      let current: string
      try {
        current = await readTextFile(abs)
      } catch {
        return false
      }
      const next = revertHunk(lineDiff(baseContent, current), hunkIndex)
      if (next === current) return false
      try {
        await writeTextFile(abs, next)
      } catch {
        return false
      }
      return true
    },

    turnFileDiff: async (messageId, path) => {
      const st = get()
      const aid = st.activeId
      const session = aid ? st.sessions[aid] : null
      if (!aid || !session?.workspacePath) return null
      const base = session.messages.find((m) => m.id === messageId)?.snapshotBase
      if (!base) return null
      const baseContent = await fileAtBase(session.id, session.workspacePath, base, path)
      if (baseContent == null) return null
      let abs: string
      try {
        abs = resolveInWorkspace(session.workspacePath, path)
      } catch {
        return null
      }
      try {
        return lineDiff(baseContent, await readTextFile(abs))
      } catch {
        return null
      }
    },

    unrevertSession: async (sessionId) => {
      const aid = sessionId ?? get().activeId
      if (!aid) return null
      const undo = revertUndo.get(aid)
      if (!undo) return null
      const session = get().sessions[aid]
      if (!session?.workspacePath) return null

      if (
        session.messages.length !== undo.baseLen ||
        (session.modelMessages?.length ?? 0) !== undo.baseModelLen
      ) {
        revertUndo.delete(aid)
        return null
      }

      const result = await revertToBase(aid, session.workspacePath, undo.redoSnapshot)

      mut(aid, (s) => ({
        ...s,
        messages: [...s.messages, ...undo.messages],
        modelMessages: [...(s.modelMessages ?? []), ...undo.modelTail],
        updatedAt: Date.now(),
      }))
      revertUndo.delete(aid)
      return result
    },

    persistSession: async (id) => {
      await flushSession(id)
    },
    persistActive: async () => {
      await flushSession(get().activeId)
    },
    persistAllPending: async () => {
      await flushAllPending()
    },

    forkAt: async (messageId) => {
      const aid = get().activeId
      const a = aid ? get().sessions[aid] : null
      if (!a) throw new Error("Aktif session yok")
      const idx = a.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) throw new Error("Mesaj bulunamadı")
      await flushSession(aid)

      const now = Date.now()
      const forkId = createId("session")
      const forkMessages = a.messages.slice(0, idx + 1).map((m) => ({ ...m }))
      const forkCut = modelBoundary(a.messages, idx + 1) ?? idx + 1
      const forkModelMsgs = (a.modelMessages ?? []).slice(0, forkCut)
      const fork: Session = {
        id: forkId,
        title: a.title + " (çatal)",
        updatedAt: now,
        messages: forkMessages,
        modelMessages: forkModelMsgs,
        provider: a.provider,
        model: a.model,
        workspacePath: a.workspacePath,
        forkParentId: a.id,
        openFiles: [],
        activeFile: null,
      }
      const cutSeq = (await dbMessageIdx(db, a.id, messageId)) ?? idx
      await forkCopy(db, fork, a.id, cutSeq)
      // modelMessages forkCopy ile kopyalanmaz (UI cutSeq ≠ model boundary) — fork'un
      await persistModelMessages(db, forkId, forkModelMsgs)
      setShadow(forkId, forkMessages, forkModelMsgs)
      seqOf.set(forkId, await nextMessageSeq(db, forkId))
      set((st) => ({
        index: [metaOf(fork), ...st.index],
        sessions: { ...st.sessions, [forkId]: fork },
        activeId: forkId,
        active: fork,
        isDraft: false,
      }))
      ensureFilesHydrated(fork)
      touchSeen(forkId)
      void evictIdle().catch(() => {})
      return forkId
    },

    patchSessionMeta: async (id, patch) => {
      const apply = <T extends SessionMeta>(o: T): T => {
        const n = { ...o }
        if ("title" in patch) n.title = patch.title ?? ""
        if ("workspacePath" in patch) n.workspacePath = patch.workspacePath
        if ("pinned" in patch) {
          if (patch.pinned) n.pinned = true
          else delete n.pinned
        }
        if ("unread" in patch) {
          if (patch.unread) n.unread = true
          else delete n.unread
        }
        if ("archived" in patch) {
          if (patch.archived) n.archived = true
          else delete n.archived
        }
        return n
      }
      set((st) => {
        const index = st.index.map((m) => (m.id === id ? apply(m) : m))
        const cur = st.sessions[id]
        if (!cur) return { index }
        const ns = apply(cur)
        const sessions = { ...st.sessions, [id]: ns }
        return { index, sessions, active: st.activeId === id ? ns : st.active }
      })
      await updateSessionColumns(db, id, patch)
    },

    forkSession: async (id) => {
      await flushSession(id)
      const src = get().sessions[id] ?? (await loadSessionScalar(db, id))
      if (!src) throw new Error("Session bulunamadı")
      const srcModelMsgs = src.modelMessages ?? (await loadModelMessages(db, id))
      await flushSession(get().activeId)

      const forkId = createId("session")
      const fork: Session = {
        id: forkId,
        title: src.title + " (çatal)",
        updatedAt: Date.now(),
        messages: [],
        modelMessages: [...srcModelMsgs],
        provider: src.provider,
        model: src.model,
        workspacePath: src.workspacePath,
        forkParentId: id,
        openFiles: [],
        activeFile: null,
      }
      await forkCopy(db, fork, id, Number.MAX_SAFE_INTEGER)
      const msgs = await loadAllMessages(db, forkId)
      fork.messages = msgs
      await persistModelMessages(db, forkId, srcModelMsgs)
      setShadow(forkId, msgs, srcModelMsgs)
      seqOf.set(forkId, await nextMessageSeq(db, forkId))
      set((st) => ({
        index: [metaOf(fork), ...st.index],
        sessions: { ...st.sessions, [forkId]: fork },
        activeId: forkId,
        active: fork,
        isDraft: false,
      }))
      ensureFilesHydrated(fork)
      touchSeen(forkId)
      void evictIdle().catch(() => {})
      return forkId
    },

    forkSessionBackground: async (id) => {
      await flushSession(id)
      const src = get().sessions[id] ?? (await loadSessionScalar(db, id))
      if (!src) throw new Error("Session bulunamadı")
      const srcModelMsgs = src.modelMessages ?? (await loadModelMessages(db, id))

      const forkId = createId("session")
      const fork: Session = {
        id: forkId,
        title: src.title + " (çatal)",
        updatedAt: Date.now(),
        messages: [],
        modelMessages: [...srcModelMsgs],
        provider: src.provider,
        model: src.model,
        workspacePath: src.workspacePath,
        forkParentId: id,
        openFiles: [],
        activeFile: null,
        mode: src.mode,
        ...(src.orchestra ? { orchestra: { ...src.orchestra } } : {}),
        ...(src.reasoningEffort ? { reasoningEffort: src.reasoningEffort } : {}),
        ...(src.permission ? { permission: [...src.permission] } : {}),
      }
      await forkCopy(db, fork, id, Number.MAX_SAFE_INTEGER)
      const msgs = await loadAllMessages(db, forkId)
      fork.messages = msgs
      await persistModelMessages(db, forkId, srcModelMsgs)
      setShadow(forkId, msgs, srcModelMsgs)
      seqOf.set(forkId, await nextMessageSeq(db, forkId))
      set((st) => ({
        index: [metaOf(fork), ...st.index],
        sessions: { ...st.sessions, [forkId]: fork },
      }))
      touchSeen(forkId)
      void evictIdle().catch(() => {})
      return forkId
    },

    deleteMessage: (id) =>
      mutActive((s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== id),
        updatedAt: Date.now(),
      })),

    clearMessages: () =>
      mutActive((s) => ({
        ...s,
        messages: [],
        modelMessages: [],
        updatedAt: Date.now(),
      })),

    loadOlderMessages: async (sessionId) => {
      const w = get().msgWindow[sessionId]
      if (!w || !w.hasOlder) return 0
      if (!get().sessions[sessionId]) return 0
      if (loadingOlderSids.has(sessionId)) return 0
      loadingOlderSids.add(sessionId)
      try {
        const page = await loadMessagesPage(db, sessionId, { beforeIdx: w.oldestIdx, limit: MSG_PAGE })
        if (page.messages.length === 0) {
          set((st) => ({ msgWindow: { ...st.msgWindow, [sessionId]: { ...w, hasOlder: false } } }))
          return 0
        }
        let applied: Message[] | null = null
        set((st) => {
          const s = st.sessions[sessionId]
          if (!s) return {}
          applied = [...page.messages, ...s.messages]
          const ns = { ...s, messages: applied }
          return {
            sessions: { ...st.sessions, [sessionId]: ns },
            active: st.activeId === sessionId ? ns : st.active,
            msgWindow: {
              ...st.msgWindow,
              [sessionId]: { oldestIdx: page.oldestIdx ?? 0, hasOlder: page.hasOlder },
            },
          }
        })
        if (applied) {
          shadowMsgs.set(sessionId, applied)
          const pm = shadowParts.get(sessionId) ?? new Map<string, Part[]>()
          for (const m of page.messages) pm.set(m.id, m.parts ?? [])
          shadowParts.set(sessionId, pm)
        }
        return page.messages.length
      } finally {
        loadingOlderSids.delete(sessionId)
      }
    },

    editMessage: (id, content) =>
      mutActive((s) => {
        const idx = s.messages.findIndex((m) => m.id === id)
        if (idx === -1) return s
        const messages = s.messages.map((m) => (m.id === id ? { ...m, content } : m))
        let modelMessages = s.modelMessages
        const start = modelBoundary(s.messages, idx)
        const count = s.messages[idx]?.modelMsgCount
        if (modelMessages && start != null && count != null && count > 0) {
          modelMessages = modelMessages.map((mm, i) => {
            if (i < start || i >= start + count || mm.role !== "user") return mm
            if (typeof mm.content === "string") return { ...mm, content }
            if (Array.isArray(mm.content)) {
              const arr = mm.content as Array<{ type: string; text?: string }>
              let replaced = false
              const parts = arr.map((p) => {
                if (!replaced && p.type === "text") {
                  replaced = true
                  return { ...p, text: content }
                }
                return p
              })
              if (!replaced) parts.unshift({ type: "text", text: content })
              return { ...mm, content: parts as unknown as typeof mm.content }
            }
            return mm
          })
        }
        return { ...s, messages, modelMessages, updatedAt: Date.now() }
      }),

    truncateAfter: (messageId) =>
      mutActive((s) => {
        const idx = s.messages.findIndex((m) => m.id === messageId)
        if (idx === -1) return s
        const cut = modelBoundary(s.messages, idx + 1) ?? idx + 1
        return {
          ...s,
          messages: s.messages.slice(0, idx + 1),
          modelMessages: (s.modelMessages ?? []).slice(0, cut),
          updatedAt: Date.now(),
        }
      }),

    remove: async (id) => {
      abortStream(id)
      const t = persistTimers.get(id)
      if (t) {
        clearTimeout(t)
        persistTimers.delete(id)
      }
      await deleteSessionRow(db, id)
      dropShadow(id)
      await clearSnapshotSession(id)
      // Bu thread'in saklanan scroll pozisyonunu unut (RAM-only, birikmesin).
      forgetScrollPosition(id)
      clearToolBeat(id)
      const wasActive = get().activeId === id
      const removedIdx = get().index.findIndex((m) => m.id === id)
      set((st) => {
        const nextIndex = st.index.filter((m) => m.id !== id)
        const sessions = { ...st.sessions }
        delete sessions[id]
        const streamingIds = { ...st.streamingIds }
        delete streamingIds[id]
        return {
          index: nextIndex,
          sessions,
          streamingIds,
          activeId: wasActive ? null : st.activeId,
          active: wasActive ? null : st.active,
          isDraft: wasActive ? false : st.isDraft,
        }
      })
      if (wasActive) {
        const neighbor = get().index[removedIdx]?.id ?? get().index[removedIdx - 1]?.id
        if (neighbor) await get().open(neighbor)
      }
    },

    addProject: async (path) => {
      const existing = get().projects
      if (existing.includes(path)) return
      await upsertProject(db, path, get().projectMeta[path] ?? {}, existing.length)
      set({ projects: [...existing, path] })
    },

    removeProject: async (path) => {
      const ids = get()
        .index.filter((m) => m.workspacePath === path)
        .map((m) => m.id)
      for (const id of ids) {
        abortStream(id)
        const t = persistTimers.get(id)
        if (t) {
          clearTimeout(t)
          persistTimers.delete(id)
        }
        await deleteSessionRow(db, id)
        dropShadow(id)
        await clearSnapshotSession(id)
      }
      await deleteProject(db, path)
      const projects = get().projects.filter((p) => p !== path)
      const projectMeta = { ...get().projectMeta }
      delete projectMeta[path]
      set((st) => {
        const activeRemoved = !!st.active && st.active.workspacePath === path
        const sessions = { ...st.sessions }
        const streamingIds = { ...st.streamingIds }
        for (const id of ids) {
          delete sessions[id]
          delete streamingIds[id]
        }
        return {
          index: st.index.filter((m) => m.workspacePath !== path),
          projects,
          projectMeta,
          sessions,
          streamingIds,
          activeId: activeRemoved ? null : st.activeId,
          active: activeRemoved ? null : st.active,
          isDraft: activeRemoved ? false : st.isDraft,
        }
      })
    },

    setProjectsOrder: async (paths) => {
      await dbSetProjectsOrder(db, paths)
      set({ projects: paths })
    },

    setProjectMeta: async (path, patch) => {
      const cur = get().projectMeta
      const merged: ProjectMeta = { ...cur[path], ...patch }
      if (!merged.name) delete merged.name
      if (!merged.color) delete merged.color
      const next = { ...cur }
      if (Object.keys(merged).length === 0) delete next[path]
      else next[path] = merged
      const projects = get().projects
      const sort = projects.indexOf(path)
      await upsertProject(db, path, merged, sort < 0 ? projects.length : sort)
      set({ projectMeta: next })
    },

    relinkProject: async (oldPath, newPath) => {
      if (!oldPath || !newPath || oldPath === newPath) return
      const projects = Array.from(
        new Set(get().projects.map((p) => (p === oldPath ? newPath : p))),
      )
      const projectMeta = { ...get().projectMeta }
      if (projectMeta[oldPath]) {
        projectMeta[newPath] = { ...projectMeta[newPath], ...projectMeta[oldPath] }
        delete projectMeta[oldPath]
      }
      const affectedIds = get()
        .index.filter((m) => m.workspacePath === oldPath)
        .map((m) => m.id)
      const patched: Record<string, Session> = {}
      for (const id of affectedIds) {
        const s = get().sessions[id] ?? (await loadSessionScalar(db, id))
        if (!s) continue
        const next = { ...s, workspacePath: newPath }
        await upsertSessionRow(db, next)
        patched[id] = next
      }
      await deleteProject(db, oldPath)
      await upsertProject(
        db,
        newPath,
        projectMeta[newPath] ?? {},
        Math.max(0, projects.indexOf(newPath)),
      )
      set((st) => {
        const sessions = { ...st.sessions }
        for (const [id, s] of Object.entries(patched)) {
          if (sessions[id]) sessions[id] = s
        }
        const index = st.index.map((m) =>
          m.workspacePath === oldPath ? { ...m, workspacePath: newPath } : m,
        )
        const active = st.activeId ? sessions[st.activeId] ?? st.active : st.active
        return { projects, projectMeta, sessions, index, active }
      })
    },

    clear: async () => {
      const metas = await listSessionMetas(db)
      for (const m of metas) {
        await deleteSessionRow(db, m.id)
        dropShadow(m.id)
        await clearSnapshotSession(m.id)
      }
      for (const p of get().projects) await deleteProject(db, p)
      persistTimers.clear()
      set({ index: [], projects: [], projectMeta: {}, sessions: {}, activeId: null, active: null, isDraft: false })
    },
  }
})
