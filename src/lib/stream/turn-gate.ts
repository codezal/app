// Turn gate: decide what happens to a user send BEFORE any message is pushed.
//
// Background: dispatchTurn pushes the user message + a pending assistant bubble
// and then calls runStream, which is single-flight per session — a second call
// returns immediately. Without a gate, a send that lands while a stream (or the
// pre-stream preparation: hooks + auto-compaction) is in flight would push UI
// messages that never reach modelMessages: the model never sees the text, the
// pending bubble spins forever, and the UI↔modelMsgCount mapping drifts.
//
// The gate mirrors the Composer's own behavior (plain text is queued while
// streaming) at the single funnel every send path goes through.

export type TurnGateDecision = "run" | "queue" | "reject"

export function decideTurnGate(args: {
  streaming: boolean
  preparing: boolean
  hasAttachments: boolean
}): TurnGateDecision {
  const busy = args.streaming || args.preparing
  if (!busy) return "run"
  // The message queue is text-only; attachments (images/files/pdfs) cannot be
  // reconstructed from a queued string, so they must be rejected with a toast
  // instead of being silently dropped.
  return args.hasAttachments ? "reject" : "queue"
}
