import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  useTokenSavingsStore,
  loadSavings,
  saveSavings,
} from "@/store/token-savings"

describe("token-savings store", () => {
  beforeEach(() => {
    useTokenSavingsStore.getState().reset()
  })

  it("record kümülatif token toplar", () => {
    const s = useTokenSavingsStore.getState()
    s.record("compactOutput", 100)
    s.record("toolDesc", 50)
    s.record("compactOutput", 25)
    const st = useTokenSavingsStore.getState()
    expect(st.tokens).toBe(175)
    expect(st.bySource.compactOutput).toBe(125)
    expect(st.bySource.toolDesc).toBe(50)
    expect(st.bySource.historyHygiene).toBe(0)
  })

  it("tokens <= 0 veya NaN no-op", () => {
    const s = useTokenSavingsStore.getState()
    s.record("compactOutput", 0)
    s.record("compactOutput", -10)
    s.record("compactOutput", Number.NaN)
    expect(useTokenSavingsStore.getState().tokens).toBe(0)
  })

  it("reset sayacı sıfırlar", () => {
    const s = useTokenSavingsStore.getState()
    s.record("historyHygiene", 999)
    expect(useTokenSavingsStore.getState().tokens).toBe(999)
    s.reset()
    const st = useTokenSavingsStore.getState()
    expect(st.tokens).toBe(0)
    expect(st.bySource.historyHygiene).toBe(0)
  })
})

describe("loadSavings / saveSavings (localStorage)", () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    })
  })

  it("save → load round-trip", () => {
    saveSavings({
      tokens: 320,
      bySource: { compactOutput: 200, toolDesc: 120, historyHygiene: 0 },
    })
    const loaded = loadSavings()
    expect(loaded.tokens).toBe(320)
    expect(loaded.bySource.compactOutput).toBe(200)
    expect(loaded.bySource.toolDesc).toBe(120)
  })

  it("boş/bozuk localStorage → sıfır state", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{bozuk json",
      setItem: () => {},
    })
    const loaded = loadSavings()
    expect(loaded.tokens).toBe(0)
    expect(loaded.bySource.historyHygiene).toBe(0)
  })

  it("eksik alanlar 0'a düşer", () => {
    saveSavings({
      tokens: 5,
      bySource: { compactOutput: 5 } as never,
    })
    const loaded = loadSavings()
    expect(loaded.bySource.toolDesc).toBe(0)
    expect(loaded.bySource.historyHygiene).toBe(0)
  })
})
