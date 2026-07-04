import { describe, it, expect } from "vitest"
import { resolveLocalLlm } from "@/lib/local-llm"
import type { LocalLlmSettings } from "@/store/types"

describe("resolveLocalLlm", () => {
  const def: LocalLlmSettings = {
    contextWindow: 131072,
    flashAttention: "enabled",
    batchSize: 2048,
    threads: 0,
    batchThreads: 0,
    speculativeMode: "off",
    draftTokens: 4,
    draftModel: "",
    agentMode: true,
  }

  it("profili olmayan model → global varsayılan", () => {
    expect(resolveLocalLlm({ localLlm: def }, "qwen.gguf")).toEqual(def)
  })

  it("model profili varsayılanın üzerine tam biner", () => {
    const gemma: LocalLlmSettings = {
      contextWindow: 32768,
      flashAttention: "disabled",
      batchSize: 1024,
      threads: 6,
      batchThreads: 8,
      speculativeMode: "mtp",
      draftTokens: 6,
      draftModel: "mtp-gemma.gguf",
      agentMode: false,
    }
    const s = { localLlm: def, localLlmByModel: { "gemma.gguf": gemma } }
    expect(resolveLocalLlm(s, "gemma.gguf")).toEqual(gemma)
    expect(resolveLocalLlm(s, "qwen.gguf")).toEqual(def)
  })

  it("kısmi profil eksik alanları varsayılandan tamamlar", () => {
    const s = { localLlm: def, localLlmByModel: { "m.gguf": { contextWindow: 16384 } as LocalLlmSettings } }
    const r = resolveLocalLlm(s, "m.gguf")
    expect(r.contextWindow).toBe(16384)
    expect(r.flashAttention).toBe("enabled") // from default
    expect(r.batchSize).toBe(2048) // from default
    expect(r.threads).toBe(0) // from default
    expect(r.batchThreads).toBe(0) // from default
    expect(r.speculativeMode).toBe("off") // from default
    expect(r.draftTokens).toBe(4) // from default
    expect(r.draftModel).toBe("") // from default
    expect(r.agentMode).toBe(true) // from default
  })

  it("modelId verilmezse varsayılan", () => {
    const s = { localLlm: def, localLlmByModel: { "m.gguf": { contextWindow: 8192 } as LocalLlmSettings } }
    expect(resolveLocalLlm(s).contextWindow).toBe(131072)
  })

  it("hiç ayar yoksa güvenli fallback (32768 / enabled / agent on)", () => {
    expect(resolveLocalLlm({}, "x.gguf")).toEqual({
      contextWindow: 32768,
      flashAttention: "enabled",
      batchSize: 2048,
      threads: 0,
      batchThreads: 0,
      speculativeMode: "off",
      draftTokens: 4,
      draftModel: "",
      agentMode: true,
    })
  })
})
