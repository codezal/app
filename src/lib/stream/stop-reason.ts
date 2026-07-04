import type { Message, Part } from "@/store/types"

export function detectStopReason(
  finishReason: string | undefined,
  lastPart: Part | undefined,
): Message["stopReason"] {
  if (finishReason === "length") return "length"
  const endedOnTool =
    lastPart?.type === "tool-call" || lastPart?.type === "tool-result"
  return endedOnTool && finishReason !== "tool-calls" ? "halted" : undefined
}
