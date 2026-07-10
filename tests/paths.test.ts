import { describe, it, expect } from "vitest"
import { resolveInWorkspace, WorkspaceError } from "@/lib/tools/paths"

describe("resolveInWorkspace", () => {
  it("basit relative path çözülür", () => {
    expect(resolveInWorkspace("/workspace", "src/main.ts")).toBe(
      "/workspace/src/main.ts",
    )
  })

  it("nested relative path çözülür", () => {
    expect(resolveInWorkspace("/ws", "a/b/c.txt")).toBe("/ws/a/b/c.txt")
  })

  it("workspace kökünü gösteren . → workspace", () => {
    expect(resolveInWorkspace("/ws", ".")).toBe("/ws")
  })

  it("../ ile workspace dışına çıkış → fırlatır", () => {
    expect(() => resolveInWorkspace("/ws", "../escape")).toThrow(WorkspaceError)
  })

  it("../../.. → fırlatır", () => {
    expect(() => resolveInWorkspace("/ws", "../../etc/passwd")).toThrow(WorkspaceError)
  })

  it("workspace içi absolute path kabul edilir", () => {
    expect(resolveInWorkspace("/ws", "/ws/src/file.ts")).toBe("/ws/src/file.ts")
  })

  it("workspace dışı absolute path → fırlatır", () => {
    expect(() => resolveInWorkspace("/ws", "/etc/passwd")).toThrow(WorkspaceError)
  })

  it("çift slash normalize edilir", () => {
    const r = resolveInWorkspace("/ws", "a//b///c.ts")
    expect(r).toBe("/ws/a/b/c.ts")
  })

  it("a/./b normalize edilir", () => {
    expect(resolveInWorkspace("/ws", "a/./b")).toBe("/ws/a/b")
  })

  it("a/b/../c normalize edilir", () => {
    expect(resolveInWorkspace("/ws", "a/b/../c")).toBe("/ws/a/c")
  })

  it("boş workspace → fırlatır", () => {
    expect(() => resolveInWorkspace("", "file.ts")).toThrow(WorkspaceError)
  })

  it("windows path ayırıcısı normalize edilir", () => {
    const r = resolveInWorkspace("/ws", "src\\lib\\file.ts")
    expect(r).toBe("/ws/src/lib/file.ts")
  })

  it("windows sürücü absolute, workspace içi → kabul", () => {
    expect(resolveInWorkspace("C:/proj", "C:\\proj\\src\\f.ts")).toBe("C:/proj/src/f.ts")
  })

  it("windows workspace karşılaştırması harf duyarsızdır", () => {
    expect(
      resolveInWorkspace(
        "C:\\Users\\Me\\repo",
        "c:\\users\\me\\repo\\src\\f.ts",
        true,
      ),
    ).toBe("c:/users/me/repo/src/f.ts")
  })

  it("windows sürücü absolute, workspace dışı → fırlatır", () => {
    expect(() => resolveInWorkspace("C:/proj", "C:\\Windows\\System32\\evil.txt")).toThrow(
      WorkspaceError,
    )
  })

  it("windows farklı sürücü → fırlatır", () => {
    expect(() => resolveInWorkspace("C:/proj", "D:\\data\\x.txt")).toThrow(WorkspaceError)
  })

  it("UNC path (\\\\server\\share) → fırlatır", () => {
    expect(() => resolveInWorkspace("/ws", "\\\\server\\share\\x.txt")).toThrow(WorkspaceError)
  })
})
