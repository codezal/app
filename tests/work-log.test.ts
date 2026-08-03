import { describe, expect, it } from "vitest"
import { buildBlocks, splitWorkLog, type Block } from "@/lib/work-log"
import type { Part } from "@/store/types"
import type { AgentCardPart } from "@/lib/orchestra/types"

function text(t: string): Part {
  return { type: "text", text: t }
}

function call(toolName: string, id = `${toolName}-1`): Part {
  return { type: "tool-call", toolCallId: id, toolName, input: {} }
}

function card(workerId: string, agentType = "worker"): AgentCardPart {
  return {
    type: "agent-card",
    workerId,
    workerIdx: 0,
    taskNum: 1,
    task: "do a thing",
    workerLabel: `${agentType} · task-1`,
    displayName: agentType,
    agentType,
    kind: "sdk",
    configSnapshot: { kind: "sdk", yolo: false },
    status: "running",
    outputLog: [],
  }
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

  it("renders each agent-card as a solo agents block", () => {
    const blocks = buildBlocks([
      call("read_file", "a"),
      card("w1", "worker"),
      card("w2", "reviewer"),
      text("done"),
    ])
    expect(blocks.map((b) => b.kind)).toEqual(["tools", "agents", "agents", "text"])
    const agentBlocks = blocks.filter((b) => b.kind === "agents")
    if (agentBlocks[0].kind === "agents" && agentBlocks[1].kind === "agents") {
      expect(agentBlocks[0].card.workerId).toBe("w1")
      expect(agentBlocks[1].card.agentType).toBe("reviewer")
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

  it("keeps agent-task cards visible (never collapses them into the work log)", () => {
    const agent: Block = { kind: "agents", key: "a1", card: card("w1") }
    const split = splitWorkLog([note, tools, agent, summary], false)
    expect(split).not.toBeNull()
    expect(split!.worklog).toEqual([note, tools])
    expect(split!.artifacts).toEqual([agent])
    expect(split!.tail).toEqual([summary])
  })

  it("returns null when only agent cards would collapse", () => {
    const agent: Block = { kind: "agents", key: "a1", card: card("w1") }
    expect(splitWorkLog([agent, summary], false)).toBeNull()
  })
})
