import { describe, expect, it } from "vitest"
import { buildBlocks, splitWorkLog, type Block } from "@/lib/work-log"
import type { Part } from "@/store/types"

function text(t: string): Part {
  return { type: "text", text: t }
}

function call(toolName: string, id = `${toolName}-1`): Part {
  return { type: "tool-call", toolCallId: id, toolName, input: {} }
}

describe("buildBlocks", () => {
  it("skips blank text and hidden tool rows", () => {
    const blocks = buildBlocks([
      text("  "),
      call("repo_overview"),
      call("bash_status"),
      text("hello"),
    ])
    expect(blocks).toEqual([{ kind: "text", key: "t3", text: "hello" }])
  })

  it("merges consecutive tool calls into one group", () => {
    const blocks = buildBlocks([call("read_file", "a"), call("grep", "b")])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe("tools")
    if (blocks[0].kind === "tools") {
      expect(blocks[0].calls.map((c) => c.toolCallId)).toEqual(["a", "b"])
    }
  })

  it("keeps open_path calls as solo blocks", () => {
    const blocks = buildBlocks([
      call("read_file", "a"),
      call("open_path", "b"),
      call("read_file", "c"),
    ])
    expect(blocks.map((b) => b.kind)).toEqual(["tools", "tools", "tools"])
    expect(blocks[1]).toMatchObject({ kind: "tools" })
    if (blocks[1].kind === "tools") {
      expect(blocks[1].calls).toHaveLength(1)
      expect(blocks[1].calls[0].toolName).toBe("open_path")
    }
  })
})

describe("splitWorkLog", () => {
  const tools: Block = { kind: "tools", key: "g1", calls: [
    { type: "tool-call", toolCallId: "a", toolName: "read_file", input: {} },
  ] }
  const note: Block = { kind: "text", key: "t0", text: "ara not" }
  const summary: Block = { kind: "text", key: "t9", text: "özet" }

  it("returns null while streaming", () => {
    expect(splitWorkLog([note, tools, summary], true)).toBeNull()
  })

  it("returns null with fewer than 2 blocks", () => {
    expect(splitWorkLog([summary], false)).toBeNull()
    expect(splitWorkLog([], false)).toBeNull()
  })

  it("returns null when the last block is not text", () => {
    expect(splitWorkLog([note, tools], false)).toBeNull()
  })

  it("returns null when there is no tool block before the summary", () => {
    expect(splitWorkLog([note, summary], false)).toBeNull()
  })

  it("collapses intermediate text + tools, keeping the trailing summary", () => {
    const split = splitWorkLog([note, tools, summary], false)
    expect(split).not.toBeNull()
    expect(split!.worklog).toEqual([note, tools])
    expect(split!.artifacts).toEqual([])
    expect(split!.tail).toEqual([summary])
  })

  it("extracts open_path artifacts out of the collapsed region", () => {
    const artifact: Block = { kind: "tools", key: "g5", calls: [
      { type: "tool-call", toolCallId: "b", toolName: "open_path", input: {} },
    ] }
    const split = splitWorkLog([note, tools, artifact, summary], false)
    expect(split).not.toBeNull()
    expect(split!.worklog).toEqual([note, tools])
    expect(split!.artifacts).toEqual([artifact])
    expect(split!.tail).toEqual([summary])
  })

  it("returns null when only artifact cards would collapse", () => {
    const artifact: Block = { kind: "tools", key: "g5", calls: [
      { type: "tool-call", toolCallId: "b", toolName: "open_path", input: {} },
    ] }
    expect(splitWorkLog([artifact, summary], false)).toBeNull()
  })
})
