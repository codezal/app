import { type Child, type Command } from "@tauri-apps/plugin-shell"
import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import { createId } from "@/lib/id"
import { spawnProgram, shellInvocation } from "@/lib/exec"
import { toast } from "@/store/toast"
import { sendDesktopNotification } from "@/lib/notify"

function notifyJobFinished(job: BackgroundJob): void {
  if (job.status === "cancelled") return
  const label = job.command.length > 60 ? job.command.slice(0, 60) + "…" : job.command
  const msg = `${job.status === "done" ? "✓ bitti" : "✕ hata"}: ${label}`
  if (job.status === "done") toast.success(msg)
  else toast.error(msg)
  if (typeof document !== "undefined" && !document.hasFocus()) {
    void sendDesktopNotification("Codezal — arka plan işi", msg, job.ownerSessionId)
  }
}

export type JobStatus = "running" | "done" | "error" | "cancelled"

export type BackgroundJob = {
  id: string
  command: string
  status: JobStatus
  output: string[]
  emitted: number
  exitCode: number | null
  startedAt: number
  finishedAt?: number
  pid?: number
  recovered?: boolean
  ownerSessionId?: string
}

const MAX_LINES = 500
const MAX_LINE_CHARS = 8 * 1024
const MAX_TOTAL_CHARS = 256 * 1024
export const DEFAULT_WAIT_MS = 30_000

export function pushRing(buf: string[], line: string, max: number): string[] {
  const clamped =
    line.length > MAX_LINE_CHARS
      ? line.slice(0, MAX_LINE_CHARS) + ` … (satır ${MAX_LINE_CHARS} karaktere kısaltıldı)`
      : line
  const out = [...buf, clamped]
  if (out.length > max) out.splice(0, out.length - max)
  let total = 0
  for (const l of out) total += l.length + 1
  while (total > MAX_TOTAL_CHARS && out.length > 1) {
    total -= out.shift()!.length + 1
  }
  return out
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

const childHandles = new Map<string, Child>()
const waiters = new Map<string, Array<(j: BackgroundJob) => void>>()
const cancelledIds = new Set<string>()

function resolveWaiters(id: string, job: BackgroundJob): void {
  const ws = waiters.get(id)
  if (!ws) return
  waiters.delete(id)
  for (const w of ws) w(job)
}

// --- Persistence (hard-crash orphan recovery) ---
const PERSIST_KEY = "codezal:bg-jobs:v1"

type PersistEntry = { id: string; command: string; pid: number; startedAt: number }

function readPersisted(): PersistEntry[] {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as PersistEntry[]) : []
  } catch {
    return []
  }
}

function writePersisted(entries: PersistEntry[]): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(entries))
  } catch {
    // Intentionally ignored.
  }
}

function persistAdd(entry: PersistEntry): void {
  const cur = readPersisted().filter((e) => e.id !== entry.id)
  cur.push(entry)
  writePersisted(cur)
}

function persistRemove(id: string): void {
  const cur = readPersisted()
  const next = cur.filter((e) => e.id !== id)
  if (next.length !== cur.length) writePersisted(next)
}

async function pidAlive(pid: number): Promise<boolean> {
  try {
    return await invoke<boolean>("process_alive", { pid })
  } catch {
    return false
  }
}

async function killPid(pid: number): Promise<void> {
  try {
    await invoke("proc_kill_tree", { pid })
  } catch {
    // Intentionally ignored.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    for (const child of childHandles.values()) {
      void invoke("proc_kill_tree", { pid: child.pid }).catch(() => {})
    }
  })
}

type JobsState = {
  jobs: Record<string, BackgroundJob>
  start: (workspace: string, command: string, ownerSessionId?: string) => Promise<string>
  adopt: (
    cmd: Command<string>,
    child: Child,
    command: string,
    ownerSessionId: string | undefined,
    partial: string[],
  ) => string
  read: (id: string) => BackgroundJob | undefined
  list: () => BackgroundJob[]
  kill: (id: string) => Promise<void>
  killBySession: (sessionId: string) => Promise<void>
  wait: (id: string, timeoutMs?: number) => Promise<BackgroundJob | undefined>
  clearFinished: () => number
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},

  start: async (workspace, command, ownerSessionId) => {
    const id = createId("job")
    const wrapped = `cd ${shellQuote(workspace)} && ${command}`
    const { program, flag } = await shellInvocation()
    const cmd = await spawnProgram(program, [flag, wrapped])

    const job: BackgroundJob = {
      id,
      command,
      status: "running",
      output: [],
      emitted: 0,
      exitCode: null,
      startedAt: Date.now(),
      ownerSessionId,
    }
    set((s) => ({ jobs: { ...s.jobs, [id]: job } }))

    const append = (line: string) => {
      set((s) => {
        const j = s.jobs[id]
        if (!j) return s
        return {
          jobs: {
            ...s.jobs,
            [id]: { ...j, output: pushRing(j.output, line, MAX_LINES), emitted: j.emitted + 1 },
          },
        }
      })
    }

    cmd.stdout.on("data", (l) => append(l))
    cmd.stderr.on("data", (l) => append(`[stderr] ${l}`))
    cmd.on("close", (p) => {
      const code = (p as { code?: number | null }).code ?? null
      set((s) => {
        const j = s.jobs[id]
        if (!j || j.status !== "running") return s
        const status: JobStatus = cancelledIds.has(id)
          ? "cancelled"
          : code === 0
            ? "done"
            : "error"
        return {
          jobs: { ...s.jobs, [id]: { ...j, status, exitCode: code, finishedAt: Date.now() } },
        }
      })
      cancelledIds.delete(id)
      childHandles.delete(id)
      persistRemove(id)
      const final = get().jobs[id]
      if (final && final.status !== "running") {
        resolveWaiters(id, final)
        notifyJobFinished(final)
      }
    })
    cmd.on("error", (err) => {
      append(`[error] ${String(err)}`)
      set((s) => {
        const j = s.jobs[id]
        if (!j || j.status !== "running") return s
        return {
          jobs: { ...s.jobs, [id]: { ...j, status: "error", finishedAt: Date.now() } },
        }
      })
      cancelledIds.delete(id)
      childHandles.delete(id)
      persistRemove(id)
      const final = get().jobs[id]
      if (final && final.status !== "running") {
        resolveWaiters(id, final)
        notifyJobFinished(final)
      }
    })

    const child = await cmd.spawn()
    childHandles.set(id, child)
    set((s) => {
      const j = s.jobs[id]
      if (!j) return s
      return { jobs: { ...s.jobs, [id]: { ...j, pid: child.pid } } }
    })
    persistAdd({ id, command, pid: child.pid, startedAt: job.startedAt })
    return id
  },

  adopt: (cmd, child, command, ownerSessionId, partial) => {
    const id = createId("job")
    const job: BackgroundJob = {
      id,
      command,
      status: "running",
      output: partial.slice(-MAX_LINES),
      emitted: partial.length,
      exitCode: null,
      startedAt: Date.now(),
      pid: child.pid,
      ownerSessionId,
    }
    set((s) => ({ jobs: { ...s.jobs, [id]: job } }))

    const append = (line: string) => {
      set((s) => {
        const j = s.jobs[id]
        if (!j) return s
        return {
          jobs: {
            ...s.jobs,
            [id]: { ...j, output: pushRing(j.output, line, MAX_LINES), emitted: j.emitted + 1 },
          },
        }
      })
    }
    cmd.stdout.on("data", (l) => append(l))
    cmd.stderr.on("data", (l) => append(`[stderr] ${l}`))
    cmd.on("close", (p) => {
      const code = (p as { code?: number | null }).code ?? null
      set((s) => {
        const j = s.jobs[id]
        if (!j || j.status !== "running") return s
        const status: JobStatus = cancelledIds.has(id) ? "cancelled" : code === 0 ? "done" : "error"
        return { jobs: { ...s.jobs, [id]: { ...j, status, exitCode: code, finishedAt: Date.now() } } }
      })
      cancelledIds.delete(id)
      childHandles.delete(id)
      persistRemove(id)
      const final = get().jobs[id]
      if (final && final.status !== "running") {
        resolveWaiters(id, final)
        notifyJobFinished(final)
      }
    })
    childHandles.set(id, child)
    persistAdd({ id, command, pid: child.pid, startedAt: job.startedAt })
    return id
  },

  read: (id) => get().jobs[id],

  list: () => Object.values(get().jobs).sort((a, b) => a.startedAt - b.startedAt),

  kill: async (id) => {
    const child = childHandles.get(id)
    cancelledIds.add(id)
    if (child) {
      // close handler iptali "cancelled" olarak finalize eder (cancelledIds set'i sayesinde).
      await invoke("proc_kill_tree", { pid: child.pid }).catch(() => {})
      await child.kill().catch(() => {})
      return
    }
    const job = get().jobs[id]
    if (job?.recovered && job.pid != null && job.status === "running") {
      await killPid(job.pid)
    }
    // Burada finalize et.
    set((s) => {
      const j = s.jobs[id]
      if (!j || j.status !== "running") return s
      return { jobs: { ...s.jobs, [id]: { ...j, status: "cancelled", finishedAt: Date.now() } } }
    })
    cancelledIds.delete(id)
    persistRemove(id)
    const final = get().jobs[id]
    if (final && final.status !== "running") resolveWaiters(id, final)
  },

  killBySession: async (sessionId) => {
    if (!sessionId) return
    const ids = Object.values(get().jobs)
      .filter((j) => j.ownerSessionId === sessionId && j.status === "running")
      .map((j) => j.id)
    await Promise.all(ids.map((id) => get().kill(id)))
  },

  wait: (id, timeoutMs = DEFAULT_WAIT_MS) => {
    const j = get().jobs[id]
    if (!j) return Promise.resolve(undefined)
    if (j.status !== "running") return Promise.resolve(j)
    return new Promise<BackgroundJob | undefined>((resolve) => {
      let settled = false
      const done = (job: BackgroundJob) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(job)
      }
      const arr = waiters.get(id) ?? []
      arr.push(done)
      waiters.set(id, arr)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        const cur = waiters.get(id)
        if (cur) {
          const i = cur.indexOf(done)
          if (i >= 0) cur.splice(i, 1)
          if (cur.length === 0) waiters.delete(id)
        }
        resolve(get().jobs[id])
      }, timeoutMs)
    })
  },

  clearFinished: () => {
    const cur = get().jobs
    const keep: Record<string, BackgroundJob> = {}
    let removed = 0
    for (const [id, j] of Object.entries(cur)) {
      if (j.status === "running") keep[id] = j
      else removed++
    }
    if (removed > 0) set({ jobs: keep })
    return removed
  },
}))

// --- Startup orphan recovery ---
async function recoverOrphans(): Promise<void> {
  const entries = readPersisted()
  if (!entries.length) return
  const alive: PersistEntry[] = []
  for (const e of entries) {
    if (!(await pidAlive(e.pid))) continue
    alive.push(e)
    useJobsStore.setState((s) => {
      if (s.jobs[e.id]) return s
      const job: BackgroundJob = {
        id: e.id,
        command: e.command,
        status: "running",
        output: ["[recovered] önceki oturumdan kalan iş — canlı çıktı yok, kill edilebilir"],
        emitted: 1,
        exitCode: null,
        startedAt: e.startedAt,
        pid: e.pid,
        recovered: true,
      }
      return { jobs: { ...s.jobs, [e.id]: job } }
    })
  }
  writePersisted(alive)
}

if (typeof window !== "undefined") {
  void recoverOrphans()
}
