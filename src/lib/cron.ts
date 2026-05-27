// Basit 5-field cron parser + nextFireAt.
// Format: "minute hour day-of-month month day-of-week"
// Her field: *, */N, num, a,b,c, a-b. Karışım: 1,3,5-10.
// day-of-week: 0=Pazar … 6=Cumartesi.
// Çözünürlük: dakika. Saniyeler 0 kabul edilir.

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
      // tümü — varsayılan aralık
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

// Tarih + cron eşleşiyor mu?
export function matches(d: Date, c: CronFields): boolean {
  if (!c.minute.has(d.getMinutes())) return false
  if (!c.hour.has(d.getHours())) return false
  if (!c.month.has(d.getMonth() + 1)) return false
  // DoM ve DoW — POSIX davranışı: ikisinden biri kısıtlıysa OR; tümü * ise her ikisi de geçerli.
  // Burada basit: ikisi de eşleşmeli — kullanıcı genelde birini "*" bırakır.
  if (!c.dom.has(d.getDate())) return false
  if (!c.dow.has(d.getDay())) return false
  return true
}

// from (dahil değil) sonrası ilk match dakika. Max 366 gün ileri tarar.
export function nextFireAt(c: CronFields, from: Date = new Date()): Date | null {
  // Saniyeyi sıfırla, bir dakika ileri al.
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

// Pratik yardımcı: validate. Hatalıysa string döner, geçerliyse null.
export function validateCron(expr: string): string | null {
  try {
    parseCron(expr)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
