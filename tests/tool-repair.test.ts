// tool-repair iç fonksiyonları — fuzzy match + JSON repair.
import { describe, it, expect } from "vitest"
import { fuzzyMatchToolName, repairJsonString } from "@/lib/tool-repair"
import type { ToolSet } from "ai"

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
    // İçinde brace yok, kapatılacak şey yok — yine de tryParse başarısız olacak.
    // Sonuç ya null ya da hâlâ parse edilemez bir string.
    if (r !== null) {
      expect(() => JSON.parse(r)).toThrow()
    }
  })
})
