import { describe, it, expect } from "vitest"
import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { compactToolDescriptionsInPlace } from "@/lib/token-savers/compress-tools"

function makeTools(): ToolSet {
  return {
    alpha: tool({
      description:
        "Please just read the file and really simply return the content, thanks.",
      inputSchema: z.object({ path: z.string().describe("the file path to read") }),
      execute: async () => "ok",
    }),
    beta: tool({
      description: "Run buildAllTools(workspace, servers) and the report.",
      inputSchema: z.object({}),
      execute: async () => "ok",
    }),
  }
}

describe("compactToolDescriptionsInPlace", () => {
  it("description'ı yerinde sıkıştırır, saved > 0", () => {
    const t = makeTools()
    const before = (t.alpha as { description?: string }).description
    const saved = compactToolDescriptionsInPlace(t)
    const after = (t.alpha as { description?: string }).description
    expect(after).not.toBe(before) // mutasyon oldu
    expect(after).not.toMatch(/\bplease\b/i)
    expect(after).not.toMatch(/\bjust\b/i)
    expect(saved).toBeGreaterThan(0)
  })

  it("korunan teknik token bozulmaz", () => {
    const t = makeTools()
    compactToolDescriptionsInPlace(t)
    const beta = (t.beta as { description?: string }).description ?? ""
    expect(beta).toContain("buildAllTools(workspace, servers)")
  })

  it("inputSchema ve execute dokunulmaz (referans korunur)", () => {
    const t = makeTools()
    const schemaBefore = (t.alpha as { inputSchema?: unknown }).inputSchema
    const execBefore = (t.alpha as { execute?: unknown }).execute
    compactToolDescriptionsInPlace(t)
    expect((t.alpha as { inputSchema?: unknown }).inputSchema).toBe(schemaBefore)
    expect((t.alpha as { execute?: unknown }).execute).toBe(execBefore)
  })

  it("countFor verilince saved yalnız o set üzerinden sayılır", () => {
    const onlyBeta = compactToolDescriptionsInPlace(makeTools(), new Set(["beta"]))
    const all = compactToolDescriptionsInPlace(makeTools())
    expect(onlyBeta).toBeLessThan(all)
    expect(onlyBeta).toBeGreaterThanOrEqual(0)
  })

  it("countFor boş set → saved 0 ama yine de mutasyona uğrar", () => {
    const t = makeTools()
    const saved = compactToolDescriptionsInPlace(t, new Set())
    expect(saved).toBe(0)
    expect((t.alpha as { description?: string }).description).not.toMatch(/\bplease\b/i)
  })
})
