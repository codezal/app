import { describe, expect, it } from "vitest"
import {
  TERMINAL_URI,
  isTerminalUri,
  makeTerminalUri,
  parseTerminalUri,
} from "../src/lib/terminal-uri"

describe("terminal URI", () => {
  it("identifies legacy and session-specific terminal URIs", () => {
    expect(isTerminalUri(TERMINAL_URI)).toBe(true)
    expect(isTerminalUri(`${TERMINAL_URI}extra`)).toBe(true)
    expect(isTerminalUri("/workspace/terminal.ts")).toBe(false)
  })

  it("round-trips terminal session ids", () => {
    const uri = makeTerminalUri("terminal:one/two")

    expect(uri).toBe("codezal-terminal:terminal%3Aone%2Ftwo")
    expect(parseTerminalUri(uri)).toBe("terminal:one/two")
    expect(parseTerminalUri(TERMINAL_URI)).toBeNull()
  })
})
