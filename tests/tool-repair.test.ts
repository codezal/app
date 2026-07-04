import { describe, it, expect } from "vitest"
import {
  fuzzyMatchToolName,
  repairJsonString,
  unwrapWrappedToolName,
  looksLikeQuotedSyntax,
  makeToolCallRepair,
} from "@/lib/tool-repair"
import { NoSuchToolError, type ToolSet } from "ai"
import type { LanguageModelV3ToolCall } from "@ai-sdk/provider"

const TOOLS: ToolSet = {
  read_file: { description: "", inputSchema: {} } as ToolSet[string],
  write_file: { description: "", inputSchema: {} } as ToolSet[string],
  apply_patch: { description: "", inputSchema: {} } as ToolSet[string],
  spawn_agent: { description: "", inputSchema: {} } as ToolSet[string],
}

describe("fuzzyMatchToolName", () => {
  it("birebir → kendisi", () => {
    expect(fuzzyMatchToolName("read_file", TOOLS)).toBe("read_file")
  })

  it("camelCase → snake_case eşler", () => {
    expect(fuzzyMatchToolName("ReadFile", TOOLS)).toBe("read_file")
    expect(fuzzyMatchToolName("writeFile", TOOLS)).toBe("write_file")
  })

  it("dash → underscore eşler", () => {
    expect(fuzzyMatchToolName("read-file", TOOLS)).toBe("read_file")
    expect(fuzzyMatchToolName("apply-patch", TOOLS)).toBe("apply_patch")
  })

  it("prefix eşleşme", () => {
    expect(fuzzyMatchToolName("write", TOOLS)).toBe("write_file")
  })

  it("çok kısa belirsiz adları fuzzy eşlemez", () => {
    const tools = {
      webfetch: { description: "", inputSchema: {} } as ToolSet[string],
      websearch: { description: "", inputSchema: {} } as ToolSet[string],
    }
    expect(fuzzyMatchToolName("web", tools)).toBeNull()
  })

  it("alakasız → null", () => {
    expect(fuzzyMatchToolName("completely_different", TOOLS)).toBeNull()
  })
})

describe("repairJsonString", () => {
  it("zaten geçerli JSON aynen döner", () => {
    const v = '{"a":1,"b":"x"}'
    expect(repairJsonString(v)).toBe(v)
  })

  it("trailing comma temizler", () => {
    const r = repairJsonString('{"a":1,"b":2,}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!).b).toBe(2)
  })

  it("array trailing comma", () => {
    const r = repairJsonString("[1,2,3,]")
    expect(JSON.parse(r!)).toEqual([1, 2, 3])
  })

  it("markdown fence sıyırır", () => {
    const r = repairJsonString('```json\n{"x":1}\n```')
    expect(JSON.parse(r!).x).toBe(1)
  })

  it("kesik kapanış brace ekler", () => {
    const r = repairJsonString('{"a":1,"b":2')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!).b).toBe(2)
  })

  it("kesik kapanış string + brace ekler", () => {
    const r = repairJsonString('{"path":"src/index.ts')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!).path).toBe("src/index.ts")
  })

  it("nested kesik bracket", () => {
    const r = repairJsonString('{"arr":[1,2,3,{"k":"v"')
    expect(r).not.toBeNull()
    const obj = JSON.parse(r!)
    expect(obj.arr).toEqual([1, 2, 3, { k: "v" }])
  })

  it("geri dönüşü olmayan çöp → null veya parse hata", () => {
    const r = repairJsonString("kesinlikle JSON değil bu")
    if (r !== null) {
      expect(() => JSON.parse(r)).toThrow()
    }
  })
})

describe("unwrapWrappedToolName", () => {
  it("Hermes-JSON blob adı → iç name + arguments açar", () => {
    const r = unwrapWrappedToolName('{"name":"read_file","arguments":{"path":"a.ts"}}')
    expect(r).not.toBeNull()
    expect(r!.name).toBe("read_file")
    expect(JSON.parse(r!.input)).toEqual({ path: "a.ts" })
  })

  it("arguments yoksa boş obje input", () => {
    const r = unwrapWrappedToolName('{"name":"x","arguments":{}}')
    expect(r!.name).toBe("x")
    expect(r!.input).toBe("{}")
  })

  it("parameters anahtarını da kabul eder", () => {
    const r = unwrapWrappedToolName('{"name":"glob","parameters":{"pattern":"**/*.ts"}}')
    expect(r!.name).toBe("glob")
    expect(JSON.parse(r!.input)).toEqual({ pattern: "**/*.ts" })
  })

  it("düz tool adı (JSON değil) → null", () => {
    expect(unwrapWrappedToolName("read_file")).toBeNull()
  })

  it("name'siz JSON → null", () => {
    expect(unwrapWrappedToolName('{"arguments":{"a":1}}')).toBeNull()
  })

  it("bozuk JSON → null", () => {
    expect(unwrapWrappedToolName('{"name":"x"')).toBeNull()
  })
})

describe("looksLikeQuotedSyntax", () => {
  it("Hermes-JSON blob → true", () => {
    expect(looksLikeQuotedSyntax('{"name":"x","arguments":{}}')).toBe(true)
  })

  it("XML/marker fragmanları → true", () => {
    expect(looksLikeQuotedSyntax("</arg_value>")).toBe(true)
    expect(looksLikeQuotedSyntax("<|tool_call>")).toBe(true)
    expect(looksLikeQuotedSyntax("<tool_call|>")).toBe(true)
  })

  it("boşluk içeren → true", () => {
    expect(looksLikeQuotedSyntax("TC_CLOSE = something")).toBe(true)
  })

  it("gerçek tool adları → false", () => {
    expect(looksLikeQuotedSyntax("read_file")).toBe(false)
    expect(looksLikeQuotedSyntax("spawn_agent")).toBe(false)
    expect(looksLikeQuotedSyntax("context7__resolve-library-id")).toBe(false)
    expect(looksLikeQuotedSyntax("ReadFile")).toBe(false)
  })
})

describe("makeToolCallRepair — sarmalanmış çağrı", () => {
  const mkCall = (toolName: string): LanguageModelV3ToolCall => ({
    type: "tool-call",
    toolCallId: "c1",
    toolName,
    input: "",
  })

  it("GLM-sarmalı gerçek çağrıyı açıp adı+argümanı düzeltir", async () => {
    const name = '{"name":"read_file","arguments":{"path":"a.ts"}}'
    const fixed = await makeToolCallRepair()({
      toolCall: mkCall(name),
      tools: TOOLS,
      error: new NoSuchToolError({ toolName: name }),
    })
    expect(fixed).not.toBeNull()
    expect(fixed!.toolName).toBe("read_file")
    expect(JSON.parse(fixed!.input as string)).toEqual({ path: "a.ts" })
  })

  it("sahte iç ad (alıntılanan sözdizimi) → null", async () => {
    const name = '{"name":"x","arguments":{}}'
    const fixed = await makeToolCallRepair()({
      toolCall: mkCall(name),
      tools: TOOLS,
      error: new NoSuchToolError({ toolName: name }),
    })
    expect(fixed).toBeNull()
  })
})
