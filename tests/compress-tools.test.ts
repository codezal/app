import { describe, it, expect } from "vitest"
import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { compactToolDescriptions } from "@/lib/token-savers/compress-tools"

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

describe("compactToolDescriptions", () => {
  it("kopyada sıkıştırır, saved > 0", () => {
    const t = makeTools()
    const before = (t.alpha as { description?: string }).description
    const { tools, saved } = compactToolDescriptions(t)
    const after = (tools.alpha as { description?: string }).description
    expect(after).not.toBe(before) // kompresyon oldu
    expect(after).not.toMatch(/\bplease\b/i)
    expect(after).not.toMatch(/\bjust\b/i)
    expect(saved).toBeGreaterThan(0)
  })

  it("M84: ORİJİNAL ToolSet'e dokunulmaz (restore gerekmez)", () => {
    const t = makeTools()
    const origDesc = (t.alpha as { description?: string }).description
    compactToolDescriptions(t)
    expect((t.alpha as { description?: string }).description).toBe(origDesc)
  })

  it("korunan teknik token bozulmaz", () => {
    const t = makeTools()
    const { tools } = compactToolDescriptions(t)
    const beta = (tools.beta as { description?: string }).description ?? ""
    expect(beta).toContain("buildAllTools(workspace, servers)")
  })

  it("inputSchema ve execute referansları kopyada korunur", () => {
    const t = makeTools()
    const schemaBefore = (t.alpha as { inputSchema?: unknown }).inputSchema
    const execBefore = (t.alpha as { execute?: unknown }).execute
    const { tools } = compactToolDescriptions(t)
    expect((tools.alpha as { inputSchema?: unknown }).inputSchema).toBe(schemaBefore)
    expect((tools.alpha as { execute?: unknown }).execute).toBe(execBefore)
  })

  it("countFor verilince saved yalnız o set üzerinden sayılır", () => {
    const onlyBeta = compactToolDescriptions(makeTools(), new Set(["beta"]))
    const all = compactToolDescriptions(makeTools())
    expect(onlyBeta.saved).toBeLessThan(all.saved)
    expect(onlyBeta.saved).toBeGreaterThanOrEqual(0)
  })

  it("countFor boş set → saved 0 ama kopyada yine de kompresyon olur", () => {
    const t = makeTools()
    const { tools, saved } = compactToolDescriptions(t, new Set())
    expect(saved).toBe(0)
    expect((tools.alpha as { description?: string }).description).not.toMatch(/\bplease\b/i)
  })
})
