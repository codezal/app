//

import type { ModelMessage } from "ai"
import { estimateTextTokens } from "@/lib/tokens"

export type HistoryHygieneOptions = { maxLines: number; maxBytes: number }
export type HistoryHygieneResult = { messages: ModelMessage[]; saved: number }

const encoder = new TextEncoder()
function byteLen(s: string): number {
  return encoder.encode(s).length
}

const MARKER_RESERVE = 80

function headByBytes(s: string, budget: number): string {
  let bytes = 0
  let end = 0
  for (const ch of s) {
    const b = byteLen(ch)
    if (bytes + b > budget) break
    bytes += b
    end += ch.length // surrogate pair = 2 UTF-16 birim
  }
  return s.slice(0, end)
}

function tailByBytes(s: string, budget: number): string {
  const chars = [...s]
  let bytes = 0
  let start = chars.length
  for (let k = chars.length - 1; k >= 0; k--) {
    const b = byteLen(chars[k]!)
    if (bytes + b > budget) break
    bytes += b
    start = k
  }
  return chars.slice(start).join("")
}

function truncate(text: string, maxLines: number, maxBytes: number): string {
  let out = text
  const lines = out.split("\n")
  // maxLines < 3 ise marker'a yer kalmaz (head+marker+tail > maxLines) → atla,
  if (lines.length > maxLines && maxLines >= 3) {
    const budget = maxLines - 1
    const head = Math.ceil(budget / 2)
    const tail = Math.floor(budget / 2)
    const dropped = lines.length - head - tail
    out = [
      ...lines.slice(0, head),
      `…[${dropped} satır kırpıldı]…`,
      ...lines.slice(lines.length - tail),
    ].join("\n")
  }
  if (byteLen(out) > maxBytes) {
    const usable = Math.max(64, maxBytes - MARKER_RESERVE)
    const headBudget = Math.floor(usable / 2)
    const tailBudget = usable - headBudget
    const head = headByBytes(out, headBudget)
    const tail = tailByBytes(out, tailBudget)
    if (head.length + tail.length < out.length) {
      const droppedBytes = byteLen(out) - byteLen(head) - byteLen(tail)
      out = head + `\n…[${droppedBytes} byte kırpıldı]…\n` + tail
    }
  }
  return out
}

type TrimResult = { output: unknown; changed: boolean; saved: number }

function trimToolResultOutput(output: unknown, maxLines: number, maxBytes: number): TrimResult {
  if (typeof output === "string") {
    const t = truncate(output, maxLines, maxBytes)
    if (t === output) return { output, changed: false, saved: 0 }
    return {
      output: t,
      changed: true,
      saved: Math.max(0, estimateTextTokens(output) - estimateTextTokens(t)),
    }
  }
  if (
    output &&
    typeof output === "object" &&
    (output as Record<string, unknown>).type === "text" &&
    typeof (output as Record<string, unknown>).value === "string"
  ) {
    const val = (output as Record<string, unknown>).value as string
    const t = truncate(val, maxLines, maxBytes)
    if (t === val) return { output, changed: false, saved: 0 }
    return {
      output: { ...(output as object), value: t },
      changed: true,
      saved: Math.max(0, estimateTextTokens(val) - estimateTextTokens(t)),
    }
  }
  return { output, changed: false, saved: 0 }
}

export function applyHistoryHygiene(
  messages: ModelMessage[],
  opts: HistoryHygieneOptions,
): HistoryHygieneResult {
  const maxLines = opts.maxLines > 0 ? opts.maxLines : 200
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : 16_384

  const userIdx: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") userIdx.push(i)
  }
  const TAIL_TURNS = 1
  const protectFrom = userIdx.length > TAIL_TURNS ? userIdx[userIdx.length - TAIL_TURNS]! : 0
  if (protectFrom === 0) return { messages, saved: 0 }

  let saved = 0
  let changed = false
  const out = messages.slice()

  for (let i = 0; i < protectFrom; i++) {
    const m = messages[i]!
    if (!Array.isArray(m.content)) continue
    const content = m.content as Array<Record<string, unknown>>
    let msgChanged = false
    const newContent = content.slice()
    for (let j = 0; j < content.length; j++) {
      const p = content[j]!
      if (p.type !== "tool-result") continue
      const trimmed = trimToolResultOutput(p.output, maxLines, maxBytes)
      if (trimmed.changed) {
        newContent[j] = { ...p, output: trimmed.output }
        saved += trimmed.saved
        msgChanged = true
      }
    }
    if (msgChanged) {
      out[i] = { ...m, content: newContent } as ModelMessage
      changed = true
    }
  }

  return { messages: changed ? out : messages, saved }
}
