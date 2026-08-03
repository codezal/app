// Routine scheduler — ticks every 30 s, fires routines whose cron matches the
// current minute, and catches up missed fires (one-shot + recurring) on start.
import { readWorkspaceRoutines, readUserRoutines, deleteRoutine, type Routine } from "./routines"
import { parseCron, matches, prevFireAt } from "./cron"
import { loadFired, saveFired, type FiredMap } from "./autopilot-state"
import { errorMessage } from "@/lib/errors"

const TICK_MS = 30_000

export type FireCallback = (routine: Routine) => void | Promise<void>

type SchedulerState = {
  timer: number | null
  workspacePath: string | undefined
  lastFiredAt: Map<string, number>
  onFire: FireCallback | null
  // Cache: routine path -> parsed cron. Rebuilt on every reload().
  parsed: Array<{ routine: Routine; cron: ReturnType<typeof parseCron> }>
  fired: FiredMap
}

const state: SchedulerState = {
  timer: null,
  workspacePath: undefined,
  lastFiredAt: new Map(),
  onFire: null,
  parsed: [],
  fired: {},
}

// Debounced persistence — coalesces rapid saveFired calls (e.g. multiple
// routines firing in the same tick) into a single disk write.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSaveFired(): void {
  if (saveTimer != null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveFired(state.fired)
  }, 500)
}

async function reload(): Promise<void> {
  const [proj, user] = await Promise.all([
    readWorkspaceRoutines(state.workspacePath),
    readUserRoutines(),
  ])
  const all = [...proj, ...user]
  const out: SchedulerState["parsed"] = []
  for (const r of all) {
    if (!r.schedule) continue
    if (r.disabled) continue
    try {
      const c = parseCron(r.schedule)
      out.push({ routine: r, cron: c })
    } catch (e) {
      console.warn(
        `[scheduler] '${r.name}' invalid cron '${r.schedule}': ${errorMessage(e)}`,
      )
    }
  }
  state.parsed = out
  const persisted = await loadFired()
  for (const [k, v] of Object.entries(persisted)) {
    if (v > (state.fired[k] ?? 0)) state.fired[k] = v
  }
  const valid = new Set(all.map((r) => r.path))
  let pruned = false
  for (const k of Object.keys(state.fired)) {
    if (!valid.has(k)) {
      delete state.fired[k]
      pruned = true
    }
  }
  if (pruned) await saveFired(state.fired)
}

function tick(): void {
  const now = new Date()
  now.setSeconds(0, 0)
  const stamp = now.getTime()
  for (const { routine, cron } of state.parsed) {
    if (!matches(now, cron)) continue
    if (state.lastFiredAt.get(routine.path) === stamp) continue
    // Also consult the PERSISTED fired map: lastFiredAt is in-memory only, so
    // after a restart within the same minute it is empty and the routine would
    // fire a second time (M99). state.fired survives restarts via loadFired().
    if ((state.fired[routine.path] ?? 0) >= stamp) continue
    state.lastFiredAt.set(routine.path, stamp)
    state.fired[routine.path] = stamp
    scheduleSaveFired()
    try {
      void state.onFire?.(routine)
    } catch (e) {
      console.warn(`[scheduler] fire error '${routine.name}':`, e)
    }
    if (routine.once) void cleanupOnce(routine)
  }
}

async function cleanupOnce(routine: Routine): Promise<void> {
  try {
    await deleteRoutine(routine.path)
  } catch (e) {
    console.warn(`[scheduler] could not delete one-shot routine '${routine.name}':`, e)
  }
  state.lastFiredAt.delete(routine.path)
  await reload()
}

// Fire one-shot routines whose fireAt has passed while the app was closed.
// Checks persisted state to avoid double-firing after a restart.
async function fireMissed(): Promise<void> {
  const now = Date.now()
  for (const { routine } of state.parsed) {
    if (!routine.once || !routine.fireAt) continue
    const scheduled = new Date(routine.fireAt).getTime()
    if (isNaN(scheduled) || scheduled > now) continue
    // Already recorded as fired (e.g. delete failed, app restarted) — skip.
    if ((state.fired[routine.path] ?? 0) >= scheduled) continue
    state.lastFiredAt.set(routine.path, scheduled)
    state.fired[routine.path] = scheduled
    try {
      void state.onFire?.(routine)
    } catch (e) {
      console.warn(`[scheduler] missed-fire error '${routine.name}':`, e)
    }
    void cleanupOnce(routine)
  }
  scheduleSaveFired()
}

// Catch up the single most recent missed recurring fire (last 24 h).
async function fireMissedRecurring(): Promise<void> {
  const nowMin = new Date()
  nowMin.setSeconds(0, 0)
  let changed = false
  for (const { routine, cron } of state.parsed) {
    if (routine.once) continue
    const last = prevFireAt(cron, nowMin)
    if (!last) continue
    const lastMs = last.getTime()
    if (lastMs === nowMin.getTime()) continue // current minute -> tick handles it
    if (lastMs <= (state.fired[routine.path] ?? 0)) continue
    state.fired[routine.path] = lastMs
    state.lastFiredAt.set(routine.path, lastMs)
    changed = true
    try {
      void state.onFire?.(routine)
    } catch (e) {
      console.warn(`[scheduler] recurring catch-up error '${routine.name}':`, e)
    }
  }
  if (changed) await saveFired(state.fired)
}

export type SchedulerInitArgs = {
  workspacePath: string | undefined
  onFire: FireCallback
}

export async function startScheduler(args: SchedulerInitArgs): Promise<void> {
  stopScheduler()
  state.workspacePath = args.workspacePath
  state.onFire = args.onFire
  await reload()
  state.timer = setInterval(tick, TICK_MS) as unknown as number
  await fireMissed()
  await fireMissedRecurring()
  tick()
}

export function stopScheduler(): void {
  if (state.timer != null) {
    clearInterval(state.timer)
    state.timer = null
  }
  if (saveTimer != null) {
    clearTimeout(saveTimer)
    saveTimer = null
    // Flush the pending write — otherwise a routine that fired within the last
    // 500 ms loses its fired timestamp and gets re-fired on the next launch.
    void saveFired(state.fired)
  }
  state.onFire = null
  state.parsed = []
}

export async function refreshScheduler(workspacePath: string | undefined): Promise<void> {
  state.workspacePath = workspacePath
  await reload()
}

export function listScheduled(): Array<{ routine: Routine; schedule: string }> {
  return state.parsed.map(({ routine }) => ({ routine, schedule: routine.schedule! }))
}
