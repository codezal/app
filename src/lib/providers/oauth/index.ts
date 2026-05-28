// OAuth flow registry — provider'ın `oauthName` alanı buradaki bir akışa map'lenir.
import { anthropicOAuth } from "./anthropic"
import { copilotOAuth } from "./github-copilot"
import type { OAuthFlow } from "./types"

const FLOWS: Record<string, OAuthFlow> = {
  anthropic: anthropicOAuth,
  "github-copilot": copilotOAuth,
}

export function getOAuthFlow(name: string): OAuthFlow | undefined {
  return FLOWS[name]
}

export function listOAuthFlows(): readonly string[] {
  return Object.keys(FLOWS)
}

export type { OAuthFlow, OAuthStartResult } from "./types"
