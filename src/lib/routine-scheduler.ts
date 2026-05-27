// Routine scheduler — kayıtlı rutinlerin cron alanını izler.
// App açıkken her 30 saniyede bir tick atar, due olan rutini fire eder.
// Aynı dakika içinde iki kez fire olmasın diye lastFiredAt in-memory Map'te.
//
// Limitler:
// - Tetikleyici uygulama açıkken çalışır (background process yok).
// - Kaçırılan tetiklemeler (uygulama kapalıyken) telafi edilmez.
// - Tek dakika çözünürlüğü.
import { readWorkspaceRoutines, readUserRoutines, type Routine } from "./routines"
import { parseCron, matches } from "./cron"

const TICK_MS = 30_000

export type FireCallback = (routine: Routine) => void | Promise<void>

type SchedulerState = {
  timer: number | null
  workspacePath: string | undefined
  lastFiredAt: Map<string, number>
  onFire: FireCallback | null
  // Cache: rutin path → parsed cron + ham expr. Refresh ile yenilenir.
  parsed: Array<{ routine: Routine; cron: ReturnType<typeof parseCron> }>
}

const state: SchedulerState = {
  timer: null,
  workspacePath: undefined,
  lastFiredAt: new Map(),
  onFire: null,
  parsed: [],
}

// Cron alanı olan rutinleri yükle + parse et.
async function reload(): Promise<void> {
  const [proj, user] = await Promise.all([
    readWorkspaceRoutines(state.workspacePath),
    readUserRoutines(),
  ])
  const all = [...proj, ...user]
  const out: SchedulerState["parsed"] = []
  for (const r of all) {
    if (!r.schedule) continue
    try {
      const c = parseCron(r.schedule)
      out.push({ routine: r, cron: c })
    } catch (e) {
      console.warn(
        `[scheduler] '${r.name}' cron geçersiz '${r.schedule}': ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  state.parsed = out
}

// Her tick: now dakikasına bakar, eşleşen + son fire'dan farklı dakikada olanı fire eder.
function tick(): void {
  const now = new Date()
  now.setSeconds(0, 0)
  const stamp = now.getTime()
  for (const { routine, cron } of state.parsed) {
    if (!matches(now, cron)) continue
    if (state.lastFiredAt.get(routine.path) === stamp) continue
    state.lastFiredAt.set(routine.path, stamp)
    try {
      void state.onFire?.(routine)
    } catch (e) {
      console.warn(`[scheduler] fire hatası '${routine.name}':`, e)
    }
  }
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
  // İlk tick'i hemen at — kullanıcı uygulamayı tetik dakikasında açabilir.
  tick()
}

export function stopScheduler(): void {
  if (state.timer != null) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.onFire = null
  state.parsed = []
}

// Dış tarafta workspace değişti veya rutin dosyası kaydedildi → yeniden yükle.
export async function refreshScheduler(workspacePath: string | undefined): Promise<void> {
  state.workspacePath = workspacePath
  await reload()
}

// Bilgilendirme — UI için (sıradaki tetiklemeleri göster).
export function listScheduled(): Array<{ routine: Routine; schedule: string }> {
  return state.parsed.map(({ routine }) => ({ routine, schedule: routine.schedule! }))
}
