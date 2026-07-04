import { describe, it, expect, beforeEach, vi } from "vitest"

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  nextId: "llm_test",
  listeners: new Map<string, (payload: unknown) => void>(),
  disposed: new Set<string>(),
  setEffectiveCtx: vi.fn(),
  setModelInfo: vi.fn(),
  setTokPerSec: vi.fn(),
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

vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        localLlm: {
          contextWindow: 32768,
          flashAttention: "enabled",
          batchSize: 2048,
          threads: 0,
          batchThreads: 0,
          speculativeMode: "off",
          draftTokens: 4,
          draftModel: "",
          agentMode: true,
        },
      },
    }),
  },
}))

vi.mock("@/store/toast", () => ({
  toast: { info: vi.fn() },
}))

vi.mock("@/lib/i18n", () => ({
  t: (_key: string, vars?: Record<string, string>) => JSON.stringify(vars ?? {}),
}))

vi.mock("@/store/local-runtime", () => ({
  useLocalRuntimeStore: {
    getState: () => ({
      setEffectiveCtx: mock.setEffectiveCtx,
      setModelInfo: mock.setModelInfo,
      setTokPerSec: mock.setTokPerSec,
    }),
  },
}))

import { localLlmFetch } from "@/lib/providers/local-fetch"
import { invoke } from "@tauri-apps/api/core"

describe("localLlmFetch", () => {
  beforeEach(() => {
    mock.invoke.mockResolvedValue(undefined)
    mock.nextId = "llm_test"
    mock.listeners.clear()
    mock.disposed.clear()
    mock.setEffectiveCtx.mockReset()
    mock.setModelInfo.mockReset()
    mock.setTokPerSec.mockReset()
  })

  it("llm_chat ve abort cancel çağrılarını aynı genId ile yapar", async () => {
    const body = JSON.stringify({ model: "qwen.gguf", messages: [] })
    const ac = new AbortController()

    await localLlmFetch("http://local.invalid/v1/chat/completions", {
      method: "POST",
      body,
      signal: ac.signal,
    })

    expect(invoke).toHaveBeenCalledWith("llm_chat", {
      args: {
        genId: "llm_test",
        request: body,
        flashAttention: "enabled",
        nCtx: 32768,
        batchSize: 2048,
        threads: 0,
        batchThreads: 0,
        speculativeMode: "off",
        draftTokens: 4,
        draftModel: "",
      },
    })

    ac.abort()

    expect(invoke).toHaveBeenCalledWith("llm_cancel", {
      args: { genId: "llm_test" },
    })
  })

  it("stream cancel yolunda hedefli cancel gönderir ve listener temizler", async () => {
    const response = await localLlmFetch("http://local.invalid/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "qwen.gguf", messages: [] }),
    })

    await response.body?.cancel()

    expect(invoke).toHaveBeenCalledWith("llm_cancel", {
      args: { genId: "llm_test" },
    })
    expect(mock.disposed.has("llm:chat:llm_test")).toBe(true)
  })
})
