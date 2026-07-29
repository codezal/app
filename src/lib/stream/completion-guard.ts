// Completion guard — catches the "reported done without doing anything" failure.
//
// Some models (observed with Kimi K3 on long multi-feature requests) answer a
// change request with a confident "All done — here is everything I added"
// summary while never calling a single file-writing tool. The stream ends
// cleanly (finishReason "stop"), so the app treats the turn as completed and
// the user only discovers the lie by opening the file. This module detects
// that pattern: a completion claim in the final text + zero write-tool calls
// in the turn + a change request in the recent user messages. run-stream then
// sends the model back with a nudge to actually apply the changes.

import type { Part } from "@/store/types"

// Tools that can actually change files on disk. bash counts as a writer
// (models sometimes write via `cat > file`), which trades a few false
// negatives (bash-only turns that didn't write) for zero false accusations.
const WRITE_TOOLS = new Set([
  "edit_file",
  "write_file",
  "apply_patch",
  "bash",
  "notebook_edit",
])

// Past-tense "I did it" claims (TR + EN). Deliberately first-person / passive
// perfect forms so neutral descriptions ("this function adds X") don't match.
const CLAIM_RE =
  /(hepsi\s+tamamlandı|her\s+şey\s+tamam|tamamlandı|tamamladım|eklendi|ekledim|düzeltildi|düzelttim|değiştirildi|değiştirdim|güncellendi|güncelledim|oluşturuldu|oluşturdum|\ball\s+done\b|\bcompleted\b|\bimplemented\b|\b(?:i|we)(?:'ve|’ve| have)\s+(?:added|fixed|implemented|created|updated|changed|written)\b)/i

// Imperative change requests (TR imperative stems + EN verbs). Word
// boundaries keep "yapabilirsin" / "değiştirdin" from matching.
const REQUEST_RE =
  /(\byap\b|\byapın\b|\bekle\b|\bekleyin\b|\bdüzelt\b|\bdeğiştir\b|\buygula\b|\boluştur\b|\bgüncelle\b|\bkaldır\b|\bsil\b|\byaz\b|\bgetir\b|\bimplement\b|\badd\b|\bfix\b|\bchange\b|\bupdate\b|\bcreate\b|\bwrite\b|\bremove\b|\bdelete\b|\bapply\b|\bbuild\b)/i

export function turnRanWriteTool(parts: Part[]): boolean {
  return parts.some(
    (p) => (p.type === "tool-call" || p.type === "tool-result") && WRITE_TOOLS.has(p.toolName),
  )
}

export function claimsCompletion(finalText: string): boolean {
  return CLAIM_RE.test(finalText)
}

export function requestsChanges(recentUserTexts: string[]): boolean {
  return recentUserTexts.some((t) => REQUEST_RE.test(t))
}

/**
 * True when the turn looks like a hallucinated completion: the user asked for
 * changes (in the last couple of user messages), the assistant's final text
 * claims work was done, yet not a single write-capable tool ran this turn.
 */
export function needsCompletionNudge(args: {
  parts: Part[]
  finalText: string
  recentUserTexts: string[]
}): boolean {
  const { parts, finalText, recentUserTexts } = args
  if (!finalText.trim()) return false
  if (turnRanWriteTool(parts)) return false
  if (!claimsCompletion(finalText)) return false
  return requestsChanges(recentUserTexts)
}

/** The message sent back to the model when a hallucinated completion is caught. */
export const COMPLETION_NUDGE_TEXT =
  "You just reported the task as completed, but no file-modifying tool ran in that turn " +
  "(no edit_file / write_file / apply_patch / bash), so nothing was actually changed on disk. " +
  "Do the work now using tools, or — if some part is genuinely impossible — reply with an explicit " +
  "'Remaining' list of what is NOT implemented. Never claim changes you have not made."
