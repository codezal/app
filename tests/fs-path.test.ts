import { describe, expect, it } from "vitest"
import { joinFsPath } from "@/lib/fs-path"

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
