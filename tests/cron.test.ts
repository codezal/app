// cron parser + matcher + nextFireAt — pure logic.
import { describe, it, expect } from "vitest"
import { parseCron, matches, nextFireAt, validateCron } from "@/lib/cron"

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
    // 12:00:30 → ilk match 13:00 olmalı (12:00 zaten geçti sayılır)
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
