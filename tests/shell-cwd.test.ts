import { describe, it, expect } from "vitest"
import { extractPwd, isWithinWorkspace, PWD_SENTINEL } from "@/lib/tools/shell-cwd"

describe("extractPwd", () => {
  it("sentinel yok → cleaned=stdout, cwd=null", () => {
    expect(extractPwd("hello\nworld", PWD_SENTINEL)).toEqual({
      cleaned: "hello\nworld",
      cwd: null,
    })
  })
  it("sentinel sonda → cwd ayıklanır, satır temizlenir", () => {
    const out = `çıktı satırı\n${PWD_SENTINEL}/home/x/proj/src\n`
    const r = extractPwd(out, PWD_SENTINEL)
    expect(r.cwd).toBe("/home/x/proj/src")
    expect(r.cleaned).toBe("çıktı satırı")
  })
  it("sadece sentinel → cleaned boş", () => {
    const r = extractPwd(`${PWD_SENTINEL}/a/b\n`, PWD_SENTINEL)
    expect(r.cwd).toBe("/a/b")
    expect(r.cleaned).toBe("")
  })
})

describe("isWithinWorkspace", () => {
  it("kök kendisi → true", () => expect(isWithinWorkspace("/ws", "/ws")).toBe(true))
  it("alt dizin → true", () => expect(isWithinWorkspace("/ws", "/ws/src")).toBe(true))
  it("dışarı → false", () => expect(isWithinWorkspace("/ws", "/etc")).toBe(false))
  it("prefix tuzağı → false", () => expect(isWithinWorkspace("/ws", "/ws-other")).toBe(false))
  it("trailing slash kök → true", () => expect(isWithinWorkspace("/ws/", "/ws/src")).toBe(true))
})
