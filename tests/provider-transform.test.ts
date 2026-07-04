import { describe, it, expect } from "vitest"
import type { ModelMessage } from "ai"
import {
  sanitizeSurrogates,
  normalizeMessages,
  applyCaching,
  reasoningEfforts,
  defaultReasoningEffort,
  resolveReasoningEffort,
  reasoningOptions,
  buildProviderOptions,
  maxOutputTokens,
  sanitizeToolSchema,
  withSchemaSanitize,
} from "@/lib/providers/transform"

describe("sanitizeSurrogates", () => {
  it("yalnız (lone) surrogate → U+FFFD", () => {
    const lone = "ab\uD800cd"
    expect(sanitizeSurrogates(lone)).toBe("ab�cd")
  })
  it("geçerli surrogate çifti korunur", () => {
    const emoji = "x\u{1F600}y" // 😀 = valid pair
    expect(sanitizeSurrogates(emoji)).toBe(emoji)
  })
})

describe("normalizeMessages — toolCallId scrub", () => {
  it("Claude: geçersiz karakterler _ olur (call + result aynı)", () => {
    const msgs: ModelMessage[] = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "a/b#1", toolName: "x", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "a/b#1", toolName: "x", output: { type: "text", value: "ok" } }] },
    ]
    const out = normalizeMessages(msgs, "anthropic", "claude-sonnet-4-6")
    const call = (out[0].content as Array<{ toolCallId: string }>)[0]
    const result = (out[1].content as Array<{ toolCallId: string }>)[0]
    expect(call.toolCallId).toBe("a_b_1")
    expect(result.toolCallId).toBe("a_b_1") // pairing korunur
  })

  it("Mistral: 9-char alfanümerik pad", () => {
    const msgs: ModelMessage[] = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "tool_xy", toolName: "x", input: {} }] },
    ]
    const out = normalizeMessages(msgs, "mistral", "mistral-large")
    const id = (out[0].content as Array<{ toolCallId: string }>)[0].toolCallId
    expect(id).toHaveLength(9)
    expect(/^[a-zA-Z0-9]+$/.test(id)).toBe(true)
    expect(id).toBe("toolxy000")
  })
})

describe("normalizeMessages — empty filter (anthropic)", () => {
  it("boş assistant mesajı düşer, dolu kalır", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
    ]
    const out = normalizeMessages(msgs, "anthropic", "claude-sonnet-4-6")
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe("user")
  })
})

describe("applyCaching", () => {
  it("Anthropic: system + son mesajlar message-level cacheControl alır", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]
    const out = applyCaching(msgs, "anthropic", "claude-sonnet-4-6")
    for (const m of out) {
      const opts = m.providerOptions as Record<string, Record<string, unknown>> | undefined
      expect(opts?.anthropic?.cacheControl).toEqual({ type: "ephemeral" })
    }
  })

  it("OpenRouter: son content part'a cacheControl konur", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const out = applyCaching(msgs, "openrouter", "anthropic/claude-sonnet-4-6")
    const part = (out[0].content as Array<{ providerOptions?: Record<string, Record<string, unknown>> }>)[0]
    expect(part.providerOptions?.openrouter?.cacheControl).toEqual({ type: "ephemeral" })
  })

  it("OpenAI: caching no-op (sunucu tarafı otomatik)", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hi" }]
    const out = applyCaching(msgs, "openai", "gpt-5")
    expect(out[0].providerOptions).toBeUndefined()
  })
})

describe("reasoningOptions", () => {
  it("Anthropic high → thinking budget", () => {
    const o = reasoningOptions({ providerId: "anthropic", modelId: "claude-sonnet-4-6", effort: "high", reasoningCapable: true, outputLimit: 64000 })
    expect(o).toHaveProperty("thinking")
    expect((o.thinking as { type: string }).type).toBe("enabled")
  })
  it("OpenAI medium → reasoningEffort", () => {
    const o = reasoningOptions({ providerId: "openai", modelId: "gpt-5", effort: "medium", reasoningCapable: true })
    expect(o).toEqual({ reasoningEffort: "medium", reasoningSummary: "auto" })
  })
  it("Google high → thinkingConfig", () => {
    const o = reasoningOptions({ providerId: "google", modelId: "gemini-3.1-pro", effort: "high", reasoningCapable: true })
    expect(o).toHaveProperty("thinkingConfig")
  })
  it("OpenRouter off → reasoning disabled", () => {
    const o = reasoningOptions({ providerId: "openrouter", modelId: "x", effort: "off", reasoningCapable: true })
    expect(o).toEqual({ reasoning: { enabled: false } })
  })
  it("reasoning desteklemeyen model → {}", () => {
    const o = reasoningOptions({ providerId: "openai", modelId: "gpt-4", effort: "high", reasoningCapable: false })
    expect(o).toEqual({})
  })
  it("thinking budget output limitini yutmaz (answer room kalır)", () => {
    const o = reasoningOptions({ providerId: "anthropic", modelId: "claude", effort: "max", reasoningCapable: true, outputLimit: 8000 })
    const budget = (o.thinking as { budgetTokens: number }).budgetTokens
    expect(budget).toBeLessThan(8000)
  })
})

describe("buildProviderOptions", () => {
  it("OpenAI: reasoning + promptCacheKey aynı key altında", () => {
    const o = buildProviderOptions({ providerId: "openai", modelId: "gpt-5", sessionId: "s1", effort: "medium", reasoningCapable: true })
    expect(o.openai).toMatchObject({ reasoningEffort: "medium", promptCacheKey: "s1" })
  })
  it("effort yoksa ve reasoning yoksa → {} (boş)", () => {
    const o = buildProviderOptions({ providerId: "deepseek", modelId: "deepseek-chat", effort: "medium", reasoningCapable: false })
    expect(Object.keys(o)).toHaveLength(0)
  })
})

describe("maxOutputTokens", () => {
  it("küçük limit korunur, büyük limit 32k'ya cap'lenir", () => {
    expect(maxOutputTokens(8000)).toBe(8000)
    expect(maxOutputTokens(100000)).toBe(32000)
    expect(maxOutputTokens(undefined)).toBe(32000)
  })
})

describe("sanitizeToolSchema", () => {
  it("Gemini: integer enum → string + type string", () => {
    const body = {
      tools: [{ functionDeclarations: [{ name: "f", parameters: { type: "object", properties: { n: { type: "integer", enum: [1, 2] } } } }] }],
    }
    const out = sanitizeToolSchema("google", "gemini-3.1-pro", body) as typeof body
    const n = out.tools[0].functionDeclarations[0].parameters.properties.n as { type: string; enum: string[] }
    expect(n.type).toBe("string")
    expect(n.enum).toEqual(["1", "2"])
  })

  it("Moonshot: $ref sibling keyword'ler atılır", () => {
    const body = {
      tools: [{ type: "function", function: { name: "f", parameters: { $ref: "#/d", description: "x" } } }],
    }
    const out = sanitizeToolSchema("moonshot", "kimi-k2", body) as typeof body
    expect(out.tools[0].function.parameters).toEqual({ $ref: "#/d" })
  })

  it("alakasız provider → body değişmez", () => {
    const body = { tools: [{ function: { parameters: { type: "object" } } }] }
    const out = sanitizeToolSchema("openai", "gpt-5", body)
    expect(out).toBe(body)
  })
})


describe("reasoningEfforts — provider tier'leri", () => {
  it("reasoning desteklemeyen model → [] (selector yok)", () => {
    expect(reasoningEfforts("openai", "gpt-4", false)).toEqual([])
  })
  it("xai/grok → sınırlı tier (off/low/high), medium YOK", () => {
    expect(reasoningEfforts("xai", "grok-4", true)).toEqual(["off", "low", "high"])
  })
  it("deepseek → tam tier", () => {
    expect(reasoningEfforts("deepseek", "deepseek-reasoner", true)).toEqual([
      "off", "low", "medium", "high", "max",
    ])
  })
  it("generic openai-compatible: gpt-stil id tier alır, diğeri almaz", () => {
    expect(reasoningEfforts("openai-compatible", "gpt-5-mini", true).length).toBe(5)
    expect(reasoningEfforts("openai-compatible", "kimi-k2", true)).toEqual([])
  })
})

describe("defaultReasoningEffort", () => {
  it("reasoning yok → undefined", () => {
    expect(defaultReasoningEffort("openai", "gpt-4", false)).toBeUndefined()
  })
  it("high sunan model → 'high' (kalite tercih)", () => {
    expect(defaultReasoningEffort("anthropic", "claude-sonnet-4-6", true)).toBe("high")
  })
  it("sınırlı tier setinde de (xai) high seçilir", () => {
    expect(defaultReasoningEffort("xai", "grok-4", true)).toBe("high")
  })
})

describe("resolveReasoningEffort — öncelik zinciri (tek otorite)", () => {
  const base = { providerId: "anthropic" as const, modelId: "claude-sonnet-4-6", reasoningCapable: true }
  it("session override her şeyi ezer", () => {
    const e = resolveReasoningEffort({ ...base, sessionEffort: "low", byModel: { "anthropic/claude-sonnet-4-6": "max" } })
    expect(e).toBe("low")
  })
  it("session yoksa model-bazlı hatırlanan tercih kazanır", () => {
    const e = resolveReasoningEffort({ ...base, byModel: { "anthropic/claude-sonnet-4-6": "max" } })
    expect(e).toBe("max")
  })
  it("hiçbiri yoksa akıllı default (anthropic → high)", () => {
    expect(resolveReasoningEffort(base)).toBe("high")
  })
  it("reasoning desteklemeyen model → final 'medium' fallback", () => {
    const e = resolveReasoningEffort({ providerId: "deepseek", modelId: "deepseek-chat", reasoningCapable: false })
    expect(e).toBe("medium")
  })
  it("byModel key formatı 'provider/model' ile eşleşmeli (yanlış key görmezden gelinir)", () => {
    const e = resolveReasoningEffort({ ...base, byModel: { "claude-sonnet-4-6": "off" } })
    expect(e).toBe("high")
  })
})

describe("reasoningOptions — tier gate (OpenCode parity)", () => {
  it("model'in sunmadığı effort → {} (xai medium tier'da değil)", () => {
    const o = reasoningOptions({ providerId: "xai", modelId: "grok-4", effort: "medium", reasoningCapable: true })
    expect(o).toEqual({})
  })
  it("xai high → emit eder (tier'da var)", () => {
    const o = reasoningOptions({ providerId: "xai", modelId: "grok-4", effort: "high", reasoningCapable: true })
    expect(Object.keys(o).length).toBeGreaterThan(0)
  })
  it("Bedrock-hosted Claude → reasoningConfig (thinking değil)", () => {
    const o = reasoningOptions({ providerId: "amazon-bedrock", modelId: "anthropic.claude-sonnet-4", effort: "high", reasoningCapable: true, outputLimit: 64000 })
    expect(o).toHaveProperty("reasoningConfig")
    expect((o.reasoningConfig as { type: string }).type).toBe("enabled")
  })
  it("Gemini off → thinkingBudget 0 (düşünme kapalı, ama config gönderilir)", () => {
    const o = reasoningOptions({ providerId: "google", modelId: "gemini-3.1-pro", effort: "off", reasoningCapable: true })
    expect(o).toEqual({ thinkingConfig: { thinkingBudget: 0 } })
  })
})

// ----- Edge / regression: mesaj normalizasyonu -----------------------------

describe("normalizeMessages — reasoning part korunması (Anthropic continuity)", () => {
  it("boş-text ama signature'lı reasoning part KORUNUR (drop → 400 olurdu)", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig123" } } },
          { type: "text", text: "cevap" },
        ],
      } as ModelMessage,
    ]
    const out = normalizeMessages(msgs, "anthropic", "claude-sonnet-4-6")
    const parts = out[0].content as Array<{ type: string }>
    expect(parts.some((p) => p.type === "reasoning")).toBe(true)
  })
  it("boş-text + signature YOK reasoning part düşer; tek part'sa mesaj komple düşer", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "reasoning", text: "   " }] as never },
    ]
    const out = normalizeMessages(msgs, "anthropic", "claude-sonnet-4-6")
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe("user")
  })
})

describe("normalizeMessages — tool-result çıktısında surrogate scrub", () => {
  it("truncated tool çıktısındaki lone surrogate → U+FFFD (sonraki istek crash etmez)", () => {
    const msgs: ModelMessage[] = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "x", output: { type: "text", value: "ok\uD800" } },
        ],
      } as ModelMessage,
    ]
    const out = normalizeMessages(msgs, "anthropic", "claude-sonnet-4-6")
    const part = (out[0].content as Array<{ output: { value: string } }>)[0]
    expect(part.output.value).toBe("ok�")
  })
})

// ----- Edge / regression: caching + provider options -----------------------

describe("applyCaching — Bedrock message-level cachePoint", () => {
  it("Bedrock: system + son mesajlar cachePoint alır", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
    ]
    const out = applyCaching(msgs, "amazon-bedrock", "anthropic.claude-sonnet-4")
    for (const m of out) {
      const opts = m.providerOptions as Record<string, Record<string, unknown>> | undefined
      expect(opts?.bedrock?.cachePoint).toEqual({ type: "default" })
    }
  })
})

describe("buildProviderOptions — OpenRouter prompt cache key", () => {
  it("openrouter: sessionId → prompt_cache_key", () => {
    const o = buildProviderOptions({ providerId: "openrouter", modelId: "x", sessionId: "sess-9", effort: "off", reasoningCapable: true })
    expect(o.openrouter).toMatchObject({ prompt_cache_key: "sess-9" })
  })
})

// ----- Edge / regression: Gemini schema sanitize ---------------------------

describe("sanitizeToolSchema — Gemini şema köşe durumları", () => {
  it("required[], var olmayan prop'lara referans veriyorsa filtrelenir", () => {
    const body = {
      tools: [{ functionDeclarations: [{ name: "f", parameters: {
        type: "object", properties: { a: { type: "string" } }, required: ["a", "ghost"],
      } }] }],
    }
    const out = sanitizeToolSchema("google", "gemini-3.1-pro", body) as typeof body
    expect(out.tools[0].functionDeclarations[0].parameters.required).toEqual(["a"])
  })
  it("non-object type üzerindeki properties/required atılır", () => {
    const body = {
      tools: [{ functionDeclarations: [{ name: "f", parameters: {
        type: "string", properties: { a: { type: "string" } }, required: ["a"],
      } }] }],
    }
    const out = sanitizeToolSchema("google", "gemini-3.1-pro", body) as { tools: Array<{ functionDeclarations: Array<{ parameters: Record<string, unknown> }> }> }
    const p = out.tools[0].functionDeclarations[0].parameters
    expect(p.properties).toBeUndefined()
    expect(p.required).toBeUndefined()
  })
  it("array items tuple → tek şemaya indirgenir", () => {
    const body = {
      tools: [{ functionDeclarations: [{ name: "f", parameters: {
        type: "array", items: [{ type: "string" }, { type: "number" }],
      } }] }],
    }
    const out = sanitizeToolSchema("google", "gemini-3.1-pro", body) as { tools: Array<{ functionDeclarations: Array<{ parameters: { items: unknown } }> }> }
    expect(out.tools[0].functionDeclarations[0].parameters.items).toEqual({ type: "string" })
  })
  it("generationConfig.responseSchema da sanitize edilir", () => {
    const body = {
      tools: [],
      generationConfig: { responseSchema: { type: "integer", enum: [1, 2] } },
    }
    const out = sanitizeToolSchema("google", "gemini-3.1-pro", body) as { generationConfig: { responseSchema: { type: string; enum: string[] } } }
    expect(out.generationConfig.responseSchema.type).toBe("string")
    expect(out.generationConfig.responseSchema.enum).toEqual(["1", "2"])
  })
})

// ----- Edge / regression: withSchemaSanitize fetch wrapper -----------------

describe("withSchemaSanitize — fetch wrapper", () => {
  it("alakasız provider → baseFetch aynen döner (wrap yok)", () => {
    const base = (() => Promise.resolve(new Response())) as unknown as typeof fetch
    expect(withSchemaSanitize(base, "openai", "gpt-5")).toBe(base)
  })

  it("Gemini: giden JSON body içindeki tool şeması sanitize edilir", async () => {
    let captured = ""
    const base = ((_input: unknown, init?: { body?: string }) => {
      captured = init?.body ?? ""
      return Promise.resolve(new Response())
    }) as unknown as typeof fetch
    const wrapped = withSchemaSanitize(base, "google", "gemini-3.1-pro")
    const body = JSON.stringify({
      tools: [{ functionDeclarations: [{ name: "f", parameters: { type: "object", properties: { n: { type: "integer", enum: [1] } } } }] }],
    })
    await wrapped("https://x", { body } as RequestInit)
    const parsed = JSON.parse(captured)
    expect(parsed.tools[0].functionDeclarations[0].parameters.properties.n.type).toBe("string")
  })

  it("non-JSON body → dokunulmadan geçer (parse hatası yutulur)", async () => {
    let captured: unknown = null
    const base = ((_input: unknown, init?: { body?: unknown }) => {
      captured = init?.body
      return Promise.resolve(new Response())
    }) as unknown as typeof fetch
    const wrapped = withSchemaSanitize(base, "google", "gemini-3.1-pro")
    await wrapped("https://x", { body: "not-json{" } as unknown as RequestInit)
    expect(captured).toBe("not-json{")
  })
})
