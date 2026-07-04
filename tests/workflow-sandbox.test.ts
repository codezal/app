import { describe, it, expect, vi } from "vitest"
import { executeScript, type ScriptApi } from "@/lib/orchestra/workflow/script-runner"
import { neutralizeGlobals, NEUTRALIZED_GLOBALS } from "@/lib/orchestra/workflow/sandbox-protocol"
import { createBudget } from "@/lib/orchestra/workflow/budget"

function mockApi(over: Partial<ScriptApi> = {}): ScriptApi {
  return {
    agent: vi.fn(async (p: string) => `agent:${p}`),
    log: vi.fn(),
    phase: vi.fn(),
    workflow: vi.fn(async () => "wf"),
    budget: createBudget(null),
    isAborted: () => false,
    ...over,
  }
}

describe("executeScript", () => {
  it("args'ı script'e geçirir + dönüş döner", async () => {
    const r = await executeScript("return args.x + 1", { x: 41 }, mockApi())
    expect(r).toBe(42)
  })

  it("agent() çağrısını API'ye yönlendirir", async () => {
    const api = mockApi()
    const r = await executeScript("return await agent('hello')", undefined, api)
    expect(api.agent).toHaveBeenCalledWith("hello")
    expect(r).toBe("agent:hello")
  })

  it("parallel: hepsini bekler, patlayan thunk null", async () => {
    const api = mockApi({
      agent: vi.fn(async (p: string) => {
        if (p === "boom") throw new Error("x")
        return p
      }),
    })
    const r = await executeScript(
      "return await parallel([() => agent('a'), () => agent('boom'), () => agent('b')])",
      undefined,
      api,
    )
    expect(r).toEqual(["a", null, "b"])
  })

  it("pipeline: her item tüm stage'leri geçer; stage throw → null", async () => {
    const r = await executeScript(
      "return await pipeline([1,2,3], async (x) => { if (x===2) throw new Error('s'); return x*10 })",
      undefined,
      mockApi(),
    )
    expect(r).toEqual([10, null, 30])
  })

  it("log + phase API'ye gider", async () => {
    const api = mockApi()
    await executeScript("log('hi'); phase('Build'); return 1", undefined, api)
    expect(api.log).toHaveBeenCalledWith("hi")
    expect(api.phase).toHaveBeenCalledWith("Build")
  })

  it("export const meta strip edilir (gövde çalışır)", async () => {
    const r = await executeScript("export const meta = { name: 'x' }\nreturn meta.name", undefined, mockApi())
    expect(r).toBe("x")
  })

  it("Date.now() determinizm için bloklu", async () => {
    await expect(executeScript("return Date.now()", undefined, mockApi())).rejects.toThrow(/Date\.now/)
  })

  it("argümansız new Date() bloklu, argümanlı geçer", async () => {
    await expect(executeScript("return new Date()", undefined, mockApi())).rejects.toThrow(/new Date/)
    const r = await executeScript("return new Date(0).getTime()", undefined, mockApi())
    expect(r).toBe(0)
  })

  it("Math.random() bloklu, kalan Math geçer", async () => {
    await expect(executeScript("return Math.random()", undefined, mockApi())).rejects.toThrow(/Math\.random/)
    const r = await executeScript("return Math.max(1, 5, 3)", undefined, mockApi())
    expect(r).toBe(5)
  })

  it("budget script'e okunur geçer", async () => {
    const r = await executeScript("return budget.remaining()", undefined, mockApi({ budget: createBudget(1000) }))
    expect(r).toBe(1000)
  })

  it("isAborted true → parallel durur", async () => {
    await expect(
      executeScript("return await parallel([() => agent('a')])", undefined, mockApi({ isAborted: () => true })),
    ).rejects.toThrow(/durduruldu/)
  })
})

describe("neutralizeGlobals", () => {
  it("tehlikeli global'leri undefined yapar, masumları korur", () => {
    const scope: Record<string, unknown> = {
      fetch: () => {},
      XMLHttpRequest: function () {},
      WebSocket: 1,
      JSON: JSON,
      Math: Math,
      myData: 42,
    }
    neutralizeGlobals(scope)
    expect(scope.fetch).toBeUndefined()
    expect(scope.XMLHttpRequest).toBeUndefined()
    expect(scope.WebSocket).toBeUndefined()
    expect(scope.JSON).toBe(JSON)
    expect(scope.Math).toBe(Math)
    expect(scope.myData).toBe(42)
  })

  it("liste fetch + XHR + WebSocket + importScripts içerir", () => {
    expect(NEUTRALIZED_GLOBALS).toContain("fetch")
    expect(NEUTRALIZED_GLOBALS).toContain("XMLHttpRequest")
    expect(NEUTRALIZED_GLOBALS).toContain("WebSocket")
    expect(NEUTRALIZED_GLOBALS).toContain("importScripts")
  })
})
