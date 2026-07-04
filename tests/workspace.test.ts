import { describe, it, expect } from "vitest"
import { basename } from "@/lib/workspace"

describe("basename", () => {
  it("Unix path'ten son segment", () => {
    expect(basename("/home/user/projects/myapp")).toBe("myapp")
  })

  it("Windows path'ten son segment", () => {
    expect(basename("C:\\Users\\user\\projects\\myapp")).toBe("myapp")
  })

  it("sondaki slash sıyrılır", () => {
    expect(basename("/home/user/myapp/")).toBe("myapp")
  })

  it("tek segment path → olduğu gibi", () => {
    expect(basename("myapp")).toBe("myapp")
  })

  it("undefined → boş string", () => {
    expect(basename(undefined)).toBe("")
  })

  it("boş string → boş string", () => {
    expect(basename("")).toBe("")
  })

  it("sadece slash → boş string", () => {
    expect(basename("/")).toBe("")
  })

  it("derin path → son segment", () => {
    expect(basename("/a/b/c/d/e")).toBe("e")
  })
})
