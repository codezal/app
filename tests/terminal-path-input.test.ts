import { describe, expect, it } from "vitest"
import { formatTerminalPathInput } from "@/lib/terminal-path-input"

describe("formatTerminalPathInput", () => {
  it("quotes POSIX paths and escapes single quotes", () => {
    expect(formatTerminalPathInput("/tmp/Erhan's file.txt", false)).toBe(
      "'/tmp/Erhan'\\''s file.txt' ",
    )
  })

  it("quotes Windows paths", () => {
    expect(formatTerminalPathInput("C:\\Users\\Erhan Erbaş\\file.txt", true)).toBe(
      '"C:\\Users\\Erhan Erbaş\\file.txt" ',
    )
  })
})
