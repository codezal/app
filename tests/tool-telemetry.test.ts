import { describe, it, expect, beforeEach } from "vitest"
import { useToolTelemetryStore, recordToolCall } from "@/store/tool-telemetry"

describe("tool-telemetry", () => {
  beforeEach(() => useToolTelemetryStore.getState().reset())

  it("çağrıları toplar (count, totalMs, maxMs, totalTokens)", () => {
    recordToolCall("bash", 100, 50, false)
    recordToolCall("bash", 300, 70, false)
    const s = useToolTelemetryStore.getState().byTool["bash"]
    expect(s.count).toBe(2)
    expect(s.totalMs).toBe(400)
    expect(s.maxMs).toBe(300)
    expect(s.totalTokens).toBe(120)
    expect(s.errors).toBe(0)
  })

  it("hata ile sonuçlanan çağrı errors'a sayılır", () => {
    recordToolCall("grep", 10, 5, true)
    expect(useToolTelemetryStore.getState().byTool["grep"].errors).toBe(1)
  })

  it("geçersiz ms/token (NaN/negatif) → 0 sayılır ama çağrı sayılır", () => {
    recordToolCall("x", NaN, -5, false)
    const s = useToolTelemetryStore.getState().byTool["x"]
    expect(s.totalMs).toBe(0)
    expect(s.totalTokens).toBe(0)
    expect(s.count).toBe(1)
  })

  it("reset tüm tool'ları temizler", () => {
    recordToolCall("a", 1, 1, false)
    useToolTelemetryStore.getState().reset()
    expect(Object.keys(useToolTelemetryStore.getState().byTool)).toHaveLength(0)
  })
})
