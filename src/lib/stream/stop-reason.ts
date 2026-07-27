import type { Message, Part } from "@/store/types"

/**
 * Tools that pause the turn to wait for the user (a question prompt or a
 * plan-mode switch approval). A turn ending on one of these is intentionally
 * waiting on the user — NOT an incomplete/halted turn — so it must never be
 * flagged as "halted" nor show the "turn may be incomplete / Continue" banner.
 */
export const USER_WAITING_TOOLS = new Set(["question", "propose_plan", "propose_build"])

export function isUserWaitingTool(name: string | undefined): boolean {
  return !!name && USER_WAITING_TOOLS.has(name)
}

export function detectStopReason(
  finishReason: string | undefined,
  lastPart: Part | undefined,
): Message["stopReason"] {
  if (finishReason === "length") return "length"
  const endedOnTool =
    lastPart?.type === "tool-call" || lastPart?.type === "tool-result"
  if (!endedOnTool) return undefined
  // A turn that stopped on a user-waiting tool is deliberately paused for the
  // user to answer — treat it as a normal stop, never as "halted".
  if (isUserWaitingTool((lastPart as { toolName?: string }).toolName)) return undefined
  // Reaching here means the run ended on a non-user-waiting tool. In normal
  // flow the SDK never stops on `tool-calls` (it executes the tool and loops),
  // so a `tool-calls` finish here means the step budget (`stopWhen`) cut the
  // turn mid-loop — and any other finish on a tool is an early truncation.
  // Both leave the task half-done with no further model turn, so flag them as
  // halted: that surfaces the "turn may be incomplete / Continue" banner and
  // lets the auto-continue logic resume, instead of stalling silently with no
  // UI affordance at all.
  return "halted"
}
