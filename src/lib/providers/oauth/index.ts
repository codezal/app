import { copilotOAuth } from "./github-copilot"
import type { OAuthFlow } from "./types"

const FLOWS: Record<string, OAuthFlow> = {
  "github-copilot": copilotOAuth,
}

export function getOAuthFlow(name: string): OAuthFlow | undefined {
  return FLOWS[name]
}

export function listOAuthFlows(): readonly string[] {
  return Object.keys(FLOWS)
}

export type { OAuthFlow, OAuthStartResult } from "./types"
