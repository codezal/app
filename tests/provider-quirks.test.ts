import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/providers/client-versions", () => ({
  getClaudeCliVersion: vi.fn().mockResolvedValue("1.2.3"),
}))

import {
  quirkHeaders,
  quirkBody,
  withQuirkBody,
  quirkUserAgent,
} from "@/lib/providers/provider-quirks"

describe("quirkHeaders", () => {
  it("openrouter → attribution headers", () => {
    const h = quirkHeaders("openrouter")
    expect(h["HTTP-Referer"]).toContain("github.com/codezal")
    expect(h["X-Title"]).toBeTruthy()
  })

  it("anthropic → beta header", () => {
    const h = quirkHeaders("anthropic")
    expect(h["anthropic-beta"]).toContain("interleaved-thinking")
  })

  it("cerebras → third-party integration header", () => {
    const h = quirkHeaders("cerebras")
    expect(h["X-Cerebras-3rd-Party-Integration"]).toBe("codezal")
  })

  it("llmgateway → X-Source header", () => {
    const h = quirkHeaders("llmgateway")
    expect(h["X-Source"]).toBeTruthy()
    expect(h["HTTP-Referer"]).toBeTruthy()
  })

  it("nvidia → billing header", () => {
    const h = quirkHeaders("nvidia")
    expect(h["X-BILLING-INVOKE-ORIGIN"]).toBeTruthy()
  })

  it("bilinmeyen provider → boş nesne", () => {
    expect(quirkHeaders("some-unknown")).toEqual({})
  })

  it("kilo → attribution headers", () => {
    const h = quirkHeaders("kilo")
    expect(h["HTTP-Referer"]).toBeTruthy()
  })
})

describe("quirkBody", () => {
  it("openrouter → usage.include:true", () => {
    const b = quirkBody("openrouter", "gpt-4o")
    expect((b.usage as { include: boolean })?.include).toBe(true)
  })

  it("openrouter + gemini-3 modeli → reasoning:high", () => {
    const b = quirkBody("openrouter", "gemini-3.1-pro")
    expect((b.reasoning as { effort: string })?.effort).toBe("high")
  })

  it("openrouter + non-gemini modeli → reasoning yok", () => {
    const b = quirkBody("openrouter", "gpt-4o")
    expect(b.reasoning).toBeUndefined()
  })

  it("baseten → chat_template_args", () => {
    const b = quirkBody("baseten", "llama-3")
    expect((b.chat_template_args as Record<string, unknown>)?.enable_thinking).toBe(true)
  })

  it("alibaba-cn → enable_thinking:true", () => {
    const b = quirkBody("alibaba-cn", "qwen-turbo")
    expect(b.enable_thinking).toBe(true)
  })

  it("bilinmeyen provider → boş nesne", () => {
    expect(quirkBody("unknown", "any-model")).toEqual({})
  })
})

describe("withQuirkBody", () => {
  it("extra body yoksa baseFetch'i olduğu gibi döner", () => {
    const base = vi.fn()
    const wrapped = withQuirkBody(base as unknown as typeof fetch, "unknown", "any")
    expect(wrapped).toBe(base)
  })

  it("extra body varsa JSON body'ye merge edilir", async () => {
    const captured: RequestInit[] = []
    const base = vi.fn((_input: unknown, init?: RequestInit) => {
      if (init) captured.push(init)
      return Promise.resolve(new Response("ok"))
    }) as unknown as typeof fetch

    const wrapped = withQuirkBody(base, "openrouter", "gpt-4o")
    await wrapped("https://api.example.com", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    })

    expect(captured).toHaveLength(1)
    const sentBody = JSON.parse(captured[0].body as string) as Record<string, unknown>
    expect(sentBody.model).toBe("gpt-4o")
    expect(sentBody.usage).toBeDefined()
  })

  it("JSON olmayan body değişmeden geçer", async () => {
    const captured: RequestInit[] = []
    const base = vi.fn((_input: unknown, init?: RequestInit) => {
      if (init) captured.push(init)
      return Promise.resolve(new Response("ok"))
    }) as unknown as typeof fetch

    const wrapped = withQuirkBody(base, "openrouter", "gpt-4o")
    await wrapped("https://api.example.com", {
      method: "POST",
      body: "not-json",
    })

    expect(captured[0].body).toBe("not-json")
  })
})

describe("quirkUserAgent", () => {
  it("kimi-for-coding → claude-cli UA", async () => {
    const h = await quirkUserAgent("kimi-for-coding")
    expect(h["User-Agent"]).toMatch(/^claude-cli\//)
  })

  it("bilinmeyen provider → boş nesne", async () => {
    const h = await quirkUserAgent("openai")
    expect(h).toEqual({})
  })
})
