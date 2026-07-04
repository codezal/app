// cron parser + matcher + nextFireAt — pure logic.
import { describe, it, expect } from "vitest"
import {
  parseCron,
  matches,
  nextFireAt,
  validateCron,
  parseDelayMinutes,
  delayToCron,
  cronFromFriendly,
  cronToFriendly,
} from "@/lib/cron"

describe("parseCron", () => {
  it("'*' tüm değerleri kapsar", () => {
    const c = parseCron("* * * * *")
    expect(c.minute.size).toBe(60)
    expect(c.hour.size).toBe(24)
    expect(c.dom.size).toBe(31)
    expect(c.month.size).toBe(12)
    expect(c.dow.size).toBe(7)
  })

  it("tek sayı", () => {
    const c = parseCron("5 9 1 1 1")
    expect(c.minute.has(5)).toBe(true)
    expect(c.minute.has(4)).toBe(false)
    expect(c.hour.has(9)).toBe(true)
    expect(c.dom.has(1)).toBe(true)
    expect(c.month.has(1)).toBe(true)
    expect(c.dow.has(1)).toBe(true)
  })

  it("aralık a-b", () => {
    const c = parseCron("0 9 * * 1-5")
    expect(c.dow.has(1)).toBe(true)
    expect(c.dow.has(5)).toBe(true)
    expect(c.dow.has(0)).toBe(false)
    expect(c.dow.has(6)).toBe(false)
  })

  it("liste a,b,c", () => {
    const c = parseCron("0,15,30,45 * * * *")
    expect(c.minute.has(0)).toBe(true)
    expect(c.minute.has(15)).toBe(true)
    expect(c.minute.has(30)).toBe(true)
    expect(c.minute.has(45)).toBe(true)
    expect(c.minute.has(1)).toBe(false)
  })

  it("step */N", () => {
    const c = parseCron("*/15 * * * *")
    expect(c.minute.has(0)).toBe(true)
    expect(c.minute.has(15)).toBe(true)
    expect(c.minute.has(30)).toBe(true)
    expect(c.minute.has(45)).toBe(true)
    expect(c.minute.has(5)).toBe(false)
  })

  it("karışım liste + aralık", () => {
    const c = parseCron("1,3,5-10 * * * *")
    expect(c.minute.has(1)).toBe(true)
    expect(c.minute.has(3)).toBe(true)
    expect(c.minute.has(5)).toBe(true)
    expect(c.minute.has(7)).toBe(true)
    expect(c.minute.has(10)).toBe(true)
    expect(c.minute.has(11)).toBe(false)
  })

  it("hatalı: 5 alan yok", () => {
    expect(() => parseCron("0 9 * *")).toThrow()
    expect(() => parseCron("")).toThrow()
  })

  it("hatalı: aralık dışı", () => {
    expect(() => parseCron("60 * * * *")).toThrow()
    expect(() => parseCron("* 25 * * *")).toThrow()
    expect(() => parseCron("* * 32 * *")).toThrow()
  })
})

describe("matches", () => {
  it("tüm '*' her tarih için true", () => {
    const c = parseCron("* * * * *")
    expect(matches(new Date(2026, 4, 27, 12, 30), c)).toBe(true)
  })

  it("dakika eşleşmesi", () => {
    const c = parseCron("30 * * * *")
    expect(matches(new Date(2026, 0, 1, 0, 30), c)).toBe(true)
    expect(matches(new Date(2026, 0, 1, 0, 29), c)).toBe(false)
  })

  it("haftaiçi 09:00 — pazar reddedilir", () => {
    const c = parseCron("0 9 * * 1-5")
    // 2026-05-25 pazartesi 09:00
    expect(matches(new Date(2026, 4, 25, 9, 0), c)).toBe(true)
    // 2026-05-24 pazar 09:00
    expect(matches(new Date(2026, 4, 24, 9, 0), c)).toBe(false)
  })
})

describe("nextFireAt", () => {
  it("şu andan sonraki ilk eşleşmeyi bulur", () => {
    const c = parseCron("30 9 * * *")
    const from = new Date(2026, 4, 27, 8, 0)
    const next = nextFireAt(c, from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(30)
    expect(next!.getDate()).toBe(27)
  })

  it("aynı dakika içinden tetiklemez, sonrakine geçer", () => {
    const c = parseCron("0 * * * *")
    const from = new Date(2026, 4, 27, 12, 0, 30)
    const next = nextFireAt(c, from)
    expect(next!.getHours()).toBe(13)
    expect(next!.getMinutes()).toBe(0)
  })

  it("gün taşar", () => {
    const c = parseCron("0 9 * * *")
    const from = new Date(2026, 4, 27, 10, 0)
    const next = nextFireAt(c, from)
    expect(next!.getDate()).toBe(28)
    expect(next!.getHours()).toBe(9)
  })
})

describe("validateCron", () => {
  it("geçerliyse null", () => {
    expect(validateCron("0 9 * * *")).toBeNull()
  })

  it("geçersizse string", () => {
    expect(validateCron("kötü")).toBeTypeOf("string")
    expect(validateCron("60 * * * *")).toBeTypeOf("string")
  })
})

describe("parseDelayMinutes", () => {
  it("dakika birimleri", () => {
    expect(parseDelayMinutes("5m")).toBe(5)
    expect(parseDelayMinutes("5min")).toBe(5)
    expect(parseDelayMinutes("1minute")).toBe(1)
    expect(parseDelayMinutes("10 minutes")).toBe(10)
  })

  it("saniye yukarı yuvarlanır, min 1", () => {
    expect(parseDelayMinutes("30s")).toBe(1)
    expect(parseDelayMinutes("90s")).toBe(2)
    expect(parseDelayMinutes("1sec")).toBe(1)
  })

  it("saat / gün", () => {
    expect(parseDelayMinutes("2h")).toBe(120)
    expect(parseDelayMinutes("1hour")).toBe(60)
    expect(parseDelayMinutes("1d")).toBe(1440)
  })

  it("geçersiz → null", () => {
    expect(parseDelayMinutes("abc")).toBeNull()
    expect(parseDelayMinutes("0m")).toBeNull()
    expect(parseDelayMinutes("5x")).toBeNull()
    expect(parseDelayMinutes("")).toBeNull()
    expect(parseDelayMinutes("5")).toBeNull()
  })
})

describe("delayToCron", () => {
  it("now+dakika sabitlenmiş cron + fireAt döner", () => {
    const from = new Date(2026, 4, 27, 12, 0, 30) // 27 May 12:00:30
    const { cron, fireAt } = delayToCron(5, from)
    expect(fireAt.getSeconds()).toBe(0)
    expect(fireAt.getHours()).toBe(12)
    expect(fireAt.getMinutes()).toBe(5)
    expect(cron).toBe("5 12 27 5 *")
  })

  it("üretilen cron tam fireAt dakikasında eşleşir", () => {
    const from = new Date(2026, 4, 27, 12, 0, 0)
    const { cron, fireAt } = delayToCron(5, from)
    expect(matches(fireAt, parseCron(cron))).toBe(true)
  })

  it("saat taşması", () => {
    const from = new Date(2026, 4, 27, 12, 58, 0)
    const { cron, fireAt } = delayToCron(5, from) // → 13:03
    expect(fireAt.getHours()).toBe(13)
    expect(fireAt.getMinutes()).toBe(3)
    expect(cron).toBe("3 13 27 5 *")
  })
})

describe("cronFromFriendly ↔ cronToFriendly", () => {
  it("everyN 5 alan üretir ve parseCron kabul eder (6-alan regresyonu)", () => {
    const cron = cronFromFriendly({ kind: "everyN", n: 3 })
    expect(cron).toBe("0 */3 * * *")
    expect(cron.trim().split(/\s+/).length).toBe(5)
    expect(() => parseCron(cron)).not.toThrow()
  })

  it("everyN round-trip friendly'ye geri döner", () => {
    expect(cronToFriendly(cronFromFriendly({ kind: "everyN", n: 6 }))).toEqual({
      kind: "everyN",
      n: 6,
    })
  })

  it("daily / weekdays / weekly round-trip", () => {
    const daily = cronFromFriendly({ kind: "daily", h: 19, m: 10 })
    expect(daily).toBe("10 19 * * *")
    expect(cronToFriendly(daily)).toEqual({ kind: "daily", h: 19, m: 10 })

    const wd = cronFromFriendly({ kind: "weekdays", h: 9, m: 0 })
    expect(wd).toBe("0 9 * * 1-5")
    expect(cronToFriendly(wd)).toEqual({ kind: "weekdays", h: 9, m: 0 })

    const wk = cronFromFriendly({ kind: "weekly", dow: 1, h: 8, m: 30 })
    expect(wk).toBe("30 8 * * 1")
    expect(cronToFriendly(wk)).toEqual({ kind: "weekly", dow: 1, h: 8, m: 30 })
  })

  it("hourly ve manual", () => {
    expect(cronFromFriendly({ kind: "hourly" })).toBe("0 * * * *")
    expect(cronToFriendly("0 * * * *")).toEqual({ kind: "hourly" })
    expect(cronFromFriendly({ kind: "manual" })).toBe("")
    expect(cronToFriendly("")).toEqual({ kind: "manual" })
  })
})
