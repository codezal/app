import type { ModelMessage } from "ai"
import type { SideChatMessage, SideChatThread } from "@/store/types"
import { createId } from "@/lib/id"

export const SIDE_CHAT_SYSTEM =
  "You are a side thread of an ongoing conversation. The messages above are the " +
  "main conversation for context. Answer the user's quick side question concisely. " +
  "You have no tools — do not claim to read files, run commands, or take actions; " +
  "reason only from the conversation above. Reply in the user's language."

export function newSideChatThread(
  modelMsgCount: number,
  id: string = createId("message"),
  createdAt: number = Date.now(),
): SideChatThread {
  return {
    id,
    createdAt,
    contextBoundary: Math.max(0, modelMsgCount),
    messages: [],
  }
}

export function buildSideChatMessages(
  context: ModelMessage[],
  turns: SideChatMessage[],
  question: string,
  system: string = SIDE_CHAT_SYSTEM,
): ModelMessage[] {
  const priorTurns: ModelMessage[] = turns
    .filter((m) => !m.pending && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content }))
  return [
    { role: "system", content: system },
    ...context,
    ...priorTurns,
    { role: "user", content: question },
  ]
}
