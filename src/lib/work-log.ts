// Codex-style collapsed work log. While a run streams, every text + tool block
// renders live. Once the stream ends, everything before the final text block
// (the summary) collapses into a single "worked for 4m 24s" row that expands
// on click. Pure logic lives here so it is testable under the node env; the
// rendering stays in MessageList.

import type { Part } from "@/store/types"
import type { AgentCardPart } from "@/lib/orchestra/types"

export type ToolCallPart = Extract<Part, { type: "tool-call" }>

export type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; calls: ToolCallPart[] }
  // One agent-task card (parallel subagent run). Rendered solo so each
  // subagent gets its own visible row, like opencode's task cards.
  | { kind: "agents"; key: string; card: AgentCardPart }

// Tool rows that add noise without value (auto-triggered plumbing).
function isHiddenToolRow(toolName: string): boolean {
  if (toolName === "repo_overview" || toolName === "bash_status") return true
  return false
}

// Artifact cards (open_path) stay out of collapsed groups and render on their
// own — burying a "file ready" card inside "N tool calls" makes it effectively
// undiscoverable. The same rule applies to the work-log collapse.
export function isSoloArtifact(block: Block): boolean {
  return block.kind === "tools" && block.calls[0]?.toolName === "open_path"
}

// Agent-task cards always stay visible (never collapsed into the work log) so
// parallel subagent runs remain discoverable, mirroring opencode's timeline.
export function isAgentBlock(block: Block): boolean {
  return block.kind === "agents"
}

// Blocks that must remain visible even when the surrounding turn collapses
// into a work-log row.
export function isKeepVisible(block: Block): boolean {
  return isSoloArtifact(block) || isAgentBlock(block)
}

export function buildBlocks(parts: Part[]): Block[] {
  const blocks: Block[] = []
  // When agent-task cards are present they already represent the parallel runs,
  // so the raw spawn_agent/delegate_agents tool rows are redundant — hide them.
  const hasCards = parts.some((p) => p.type === "agent-card")
  parts.forEach((p, i) => {
    if (p.type === "text") {
      if (!p.text.trim()) return
      blocks.push({ kind: "text", key: `t${i}`, text: p.text })
    } else if (p.type === "agent-card") {
      // One card per subagent, rendered solo so each stays its own row.
      blocks.push({ kind: "agents", key: `a${i}`, card: p })
    } else if (p.type === "tool-call") {
      if (isHiddenToolRow(p.toolName)) return
      if (hasCards && (p.toolName === "spawn_agent" || p.toolName === "delegate_agents")) return
      const solo = p.toolName === "open_path"
      const last = blocks[blocks.length - 1]
      if (!solo && last && last.kind === "tools" && last.calls[0]?.toolName !== "open_path") {
        last.calls.push(p)
        return
      }
      blocks.push({ kind: "tools", key: `g${i}`, calls: [p] })
    }
  })
  return blocks
}

export type WorkLogSplit = {
  // Blocks that collapse into the "worked for …" row (intermediate narration
  // text + tool groups).
  worklog: Block[]
  // open_path artifact cards extracted from the collapsed region — they stay
  // visible between the work-log row and the final summary.
  artifacts: Block[]
  // The final block(s) rendered outside the collapse. Currently always the
  // single trailing text block (the run summary).
  tail: Block[]
}

// Returns null when the message should render fully expanded:
//  - still streaming (live progress stays visible),
//  - fewer than 2 blocks (nothing to hide),
//  - no trailing text block (the run ended on a tool call — the tool output
//    IS the result, so there is no summary to keep visible),
//  - no tool block before the summary (pure multi-paragraph text is content,
//    not a work log),
//  - the collapsed region would be empty (e.g. only artifact cards precede
//    the summary).
export function splitWorkLog(blocks: Block[], streaming: boolean): WorkLogSplit | null {
  if (streaming) return null
  if (blocks.length < 2) return null
  const last = blocks[blocks.length - 1]
  if (last.kind !== "text") return null
  const head = blocks.slice(0, -1)
  if (!head.some((b) => b.kind === "tools")) return null
  const artifacts = head.filter(isKeepVisible)
  const worklog = head.filter((b) => !isKeepVisible(b))
  if (worklog.length === 0) return null
  return { worklog, artifacts, tail: [last] }
}
