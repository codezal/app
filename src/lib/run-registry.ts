//
//
import { useQuestionsStore } from "@/store/questions"

const streamAborts = new Map<string, AbortController>()

export function setStreamAbort(sessionId: string, ac: AbortController): void {
  streamAborts.set(sessionId, ac)
}

export function abortStream(sessionId: string): void {
  streamAborts.get(sessionId)?.abort()
  useQuestionsStore.getState().cancelBySession(sessionId)
}

export function clearStreamAbort(sessionId: string, ac: AbortController): void {
  if (streamAborts.get(sessionId) === ac) streamAborts.delete(sessionId)
}
