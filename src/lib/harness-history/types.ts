
export type HarnessKind = "claude-code" | "codex" | "opencode" | "cursor"

export const HARNESS_KINDS: HarnessKind[] = ["claude-code", "codex", "opencode", "cursor"]

export type HarnessRole = "user" | "assistant" | "system" | "tool"

export type HarnessMessage = {
  role: HarnessRole
  text: string
  ts?: number
}

export type HarnessThread = {
  // Global benzersiz: `${harness}:${nativeId}`.
  id: string
  harness: HarnessKind
  nativeId: string
  projectPath?: string
  title: string
  // epoch ms.
  startedAt?: number
  updatedAt?: number
  sourceRef: string
  messages: HarnessMessage[]
}

export type SessionSource = {
  nativeId: string
  sourceRef: string
  mtime: number
  load: () => Promise<HarnessThread | null>
}

export type ThreadHit = {
  threadId: string
  harness: HarnessKind
  title: string
  projectPath?: string
  updatedAt?: number
  score: number
  snippet: string
}
