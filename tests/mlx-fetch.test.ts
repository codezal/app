import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  nextId: "llm_mlx_test",
  listeners: new Map<string, (payload: unknown) => void>(),
  disposed: new Set<string>(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
}))

vi.mock("@/lib/id", () => ({
  createId: vi.fn(() => mock.nextId),
}))

vi.mock("@/lib/tauri-events", () => ({
  bufferedListen: vi.fn(async (event: string) => ({
    attach(cb: (payload: unknown) => void) {
      mock.listeners.set(event, cb)
      return () => mock.listeners.delete(event)
    },
    dispose() {
      mock.disposed.add(event)
      mock.listeners.delete(event)
    },
  })),
}))

import { mlxFetch } from "@/lib/providers/mlx-fetch"
import { invoke } from "@tauri-apps/api/core"
import { useLocalRuntimeStore } from "@/store/local-runtime"

describe("mlxFetch", () => {
  beforeEach(() => {
    vi.useRealTimers()
    mock.invoke.mockResolvedValue(undefined)
    mock.nextId = "llm_mlx_test"
    mock.listeners.clear()
    mock.disposed.clear()
    useLocalRuntimeStore.getState().setLastStats(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("mlx_chat and abort cancel use the same genId", async () => {
    const body = JSON.stringify({ model: "mlx-community/Qwen3-4B-4bit", messages: [] })
    const ac = new AbortController()

    await mlxFetch("http://mlx.local.invalid/v1/chat/completions", {
      method: "POST",
      body,
      signal: ac.signal,
    })

    expect(invoke).toHaveBeenCalledWith("mlx_chat", {
      args: {
        genId: "llm_mlx_test",
        request: body,
      },
    })

    ac.abort()

    expect(invoke).toHaveBeenCalledWith("mlx_cancel", {
      args: { genId: "llm_mlx_test" },
    })
    expect(mock.disposed.has("mlx:chat:llm_mlx_test")).toBe(true)
  })

  it("stream cancel sends targeted cancel and disposes the listener", async () => {
    const response = await mlxFetch("http://mlx.local.invalid/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "mlx-community/Qwen3-4B-4bit", messages: [] }),
    })

    await response.body?.cancel()

    expect(invoke).toHaveBeenCalledWith("mlx_cancel", {
      args: { genId: "llm_mlx_test" },
    })
    expect(mock.disposed.has("mlx:chat:llm_mlx_test")).toBe(true)
  })

  it("records native MLX generation stats from the done event", async () => {
    const model = "mlx-community/Qwen3-4B-4bit"
    const response = await mlxFetch("http://mlx.local.invalid/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model, messages: [] }),
    })

    const text = response.text()
    mock.listeners.get("mlx:chat:llm_mlx_test")?.({
      kind: "done",
      finish_reason: "stop",
      model,
      tokens_per_sec: 17.25,
      tokens: 42,
      ttft_ms: 350,
    })
    await text

    expect(useLocalRuntimeStore.getState().lastStats).toEqual({
      model,
      tokPerSec: 17.25,
      tokens: 42,
      ttftMs: 350,
    })
  })

  it("times out stalled streams and disposes the listener", async () => {
    vi.useFakeTimers()
    const response = await mlxFetch("http://mlx.local.invalid/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "mlx-community/Qwen3-4B-4bit", messages: [] }),
    })

    const text = expect(response.text()).rejects.toThrow("MLX stream timed out")
    await vi.advanceTimersByTimeAsync(180_000)

    await text
    expect(invoke).toHaveBeenCalledWith("mlx_cancel", {
      args: { genId: "llm_mlx_test" },
    })
    expect(mock.disposed.has("mlx:chat:llm_mlx_test")).toBe(true)
  })
})
