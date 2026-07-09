import { describe, expect, it } from "vitest"
import { joinFsPath, normalizeNativeFsPath } from "@/lib/fs-path"

describe("joinFsPath", () => {
  it("joins POSIX paths with forward slash", () => {
    expect(joinFsPath("/Users/me/project", "src")).toBe("/Users/me/project/src")
  })

  it("preserves Windows drive separators", () => {
    expect(joinFsPath("C:\\Users\\me\\project", "src")).toBe("C:\\Users\\me\\project\\src")
  })

  it("preserves UNC separators", () => {
    expect(joinFsPath("\\\\server\\share\\project", "src")).toBe("\\\\server\\share\\project\\src")
  })

  it("trims trailing separators before joining", () => {
    expect(joinFsPath("C:\\Users\\me\\project\\", "src")).toBe("C:\\Users\\me\\project\\src")
    expect(joinFsPath("/Users/me/project/", "src")).toBe("/Users/me/project/src")
  })
})

describe("normalizeNativeFsPath", () => {
  it("converts an MSYS drive path on Windows", () => {
    expect(normalizeNativeFsPath("/c/Users/me/project", true)).toBe("C:/Users/me/project")
    expect(normalizeNativeFsPath("/d", true)).toBe("D:/")
  })

  it("preserves native and non-Windows paths", () => {
    expect(normalizeNativeFsPath("C:\\Users\\me\\project", true)).toBe(
      "C:\\Users\\me\\project",
    )
    expect(normalizeNativeFsPath("/c/Users/me/project", false)).toBe("/c/Users/me/project")
    expect(normalizeNativeFsPath("/cygdrive/c/project", true)).toBe("/cygdrive/c/project")
  })
})
