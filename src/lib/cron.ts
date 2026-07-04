// Basit 5-field cron parser + nextFireAt.
// Format: "minute hour day-of-month month day-of-week"
// day-of-week: 0=Pazar … 6=Cumartesi.
import { errorMessage } from "@/lib/errors"

export type CronFields = {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
}

const RANGES: Record<keyof CronFields, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
}

function expand(piece: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>()
  for (const part of piece.split(",")) {
    let step = 1
    let body = part
    const slash = part.indexOf("/")
    if (slash !== -1) {
      step = parseInt(part.slice(slash + 1), 10)
      if (!Number.isFinite(step) || step <= 0) throw new Error(`Cron geçersiz step: ${part}`)
      body = part.slice(0, slash)
    }
    let start = lo
    let end = hi
    if (body === "*" || body === "") {
      // Full range.
    } else if (body.includes("-")) {
      const [a, b] = body.split("-").map((s) => parseInt(s, 10))
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Cron geçersiz aralık: ${part}`)
      start = a
      end = b
    } else {
      const n = parseInt(body, 10)
      if (!Number.isFinite(n)) throw new Error(`Cron geçersiz değer: ${part}`)
      start = n
      end = n
    }
    if (start < lo || end > hi || start > end) {
      throw new Error(`Cron aralık dışı (${lo}-${hi}): ${part}`)
    }
    for (let v = start; v <= end; v += step) out.add(v)
  }
  return out
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Cron 5 alan olmalı (m h dom mon dow), aldım: ${expr}`)
  }
  return {
    minute: expand(parts[0], RANGES.minute),
    hour: expand(parts[1], RANGES.hour),
    dom: expand(parts[2], RANGES.dom),
    month: expand(parts[3], RANGES.month),
    dow: expand(parts[4], RANGES.dow),
  }
}

export function matches(d: Date, c: CronFields): boolean {
  if (!c.minute.has(d.getMinutes())) return false
  if (!c.hour.has(d.getHours())) return false
  if (!c.month.has(d.getMonth() + 1)) return false
  if (!c.dom.has(d.getDate())) return false
  if (!c.dow.has(d.getDay())) return false
  return true
}

export function nextFireAt(c: CronFields, from: Date = new Date()): Date | null {
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const maxIter = 366 * 24 * 60
  for (let i = 0; i < maxIter; i++) {
    if (matches(d, c)) return d
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

export function prevFireAt(c: CronFields, from: Date = new Date(), maxMinutes = 1440): Date | null {
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  for (let i = 0; i < maxMinutes; i++) {
    d.setMinutes(d.getMinutes() - 1)
    if (matches(d, c)) return d
  }
  return null
}

export function validateCron(expr: string): string | null {
  try {
    parseCron(expr)
  } catch (e) {
    return errorMessage(e)
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length === 5) {
    const m = parts[0].match(/^\*\/(\d+)$/)
    const hourWild = parts[1] === "*" || parts[1].startsWith("*/")
    if (m && hourWild) {
      const n = parseInt(m[1], 10)
      if (n < 60) {
        return "Sub-hour cron rejected: minimum interval is 1 hour (use `0 */N * * *` for hourly multiples)"
      }
    }
  }
  return null
}


// h/hr/hour(s), d/day(s).
export function parseDelayMinutes(token: string): number | null {
  const m = token
    .trim()
    .match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1) return null
  const u = m[2].toLowerCase()
  let mins: number
  if (u.startsWith("h")) mins = n * 60
  else if (u.startsWith("d")) mins = n * 60 * 24
  else if (u.startsWith("s")) mins = Math.ceil(n / 60)
  else mins = n // m / min / minute
  return Math.max(1, mins)
}

export function delayToCron(
  minutes: number,
  from: Date = new Date(),
): { cron: string; fireAt: Date } {
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + Math.max(1, Math.round(minutes)))
  const cron = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
  return { cron, fireAt: d }
}


export type FriendlySchedule =
  | { kind: "manual" }
  | { kind: "hourly" }
  | { kind: "everyN"; n: number }
  | { kind: "daily"; h: number; m: number }
  | { kind: "weekdays"; h: number; m: number }
  | { kind: "weekly"; dow: number; h: number; m: number }
  | { kind: "advanced"; cron: string }

export function cronToFriendly(cron: string | undefined | null): FriendlySchedule {
  if (!cron || !cron.trim()) return { kind: "manual" }
  const p = cron.trim().split(/\s+/)
  if (p.length !== 5) return { kind: "advanced", cron }
  const [mn, hr, dom, mon, dow] = p
  const everyHr = hr.match(/^\*\/(\d+)$/)
  if (mn === "0" && everyHr && dom === "*" && mon === "*" && dow === "*") {
    return { kind: "everyN", n: Math.max(1, parseInt(everyHr[1], 10)) }
  }
  if (mn === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { kind: "hourly" }
  }
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && dom === "*" && mon === "*") {
    const m = parseInt(mn, 10)
    const h = parseInt(hr, 10)
    if (dow === "*") return { kind: "daily", h, m }
    if (dow === "1-5") return { kind: "weekdays", h, m }
    if (/^[0-6]$/.test(dow)) return { kind: "weekly", dow: parseInt(dow, 10), h, m }
  }
  return { kind: "advanced", cron }
}

export function cronFromFriendly(f: FriendlySchedule): string {
  switch (f.kind) {
    case "manual":
      return ""
    case "hourly":
      return "0 * * * *"
    case "everyN":
      // 5 alan: minute=0, hour=*/N, dom/mon/dow=*.
      return `0 */${Math.max(1, Math.floor(f.n))} * * *`
    case "daily":
      return `${f.m} ${f.h} * * *`
    case "weekdays":
      return `${f.m} ${f.h} * * 1-5`
    case "weekly":
      return `${f.m} ${f.h} * * ${f.dow}`
    case "advanced":
      return f.cron
  }
}
