// URI scheme for the in-editor PR conversation tab — parallel to output-doc.ts.
// The tab model is `openFiles: string[]`, so the URI carries only a short id +
// title; the conversation payload lives in an in-memory registry.
//
// Ephemeral: after a session reload (openFiles restored from disk, registry
// empty) the viewer shows "no longer available" — reopen from the PR panel.
import type { PrComment } from "@/lib/github"

const PREFIX = "codezal-pr:"
// Bound memory — oldest entries drop (Map insertion order = FIFO).
const MAX_ENTRIES = 30

export type PrConversation = {
  number: number
  title: string
  htmlUrl: string
  author: string
  body: string
  comments: PrComment[]
}

const store = new Map<string, PrConversation>()
let seq = 0

export function isPrUri(s: string): boolean {
  return s.startsWith(PREFIX)
}

// Store a conversation, return its URI. Tab label shows `PR #<n>`.
export function makePrDoc(conv: PrConversation): string {
  const id = `p${++seq}`
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(id, conv)
  return `${PREFIX}${id}:${encodeURIComponent(`PR #${conv.number}`)}`
}

export function parsePrUri(uri: string): { id: string; title: string } | null {
  if (!isPrUri(uri)) return null
  const rest = uri.slice(PREFIX.length)
  const i = rest.indexOf(":")
  if (i < 0) return null
  return { id: rest.slice(0, i), title: decodeURIComponent(rest.slice(i + 1)) }
}

// Payload — undefined if absent (post-reload). Viewer handles it.
export function getPrConversation(id: string): PrConversation | undefined {
  return store.get(id)
}
