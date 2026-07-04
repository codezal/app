// OAuth flow contracts.
//   1. Authorization Code + PKCE (Anthropic Claude Pro/Max)
//   2. Device Code (GitHub Copilot)
import type { OAuthCredential } from "../types"

export type OAuthStartResult =
  | {
      kind: "authCodePkce"
      authorizeUrl: string
      state: string
    }
  | {
      kind: "deviceCode"
      verificationUri: string
      userCode: string
      deviceCode: string
      expiresAt: number
      interval: number
    }

export interface OAuthFlow {
  name: string
  // user_code + polling parametreleri.
  start(): Promise<OAuthStartResult>
  completeAuthCode?(input: { callbackUrl: string; state: string }): Promise<OAuthCredential>
  // Device flow polling.
  pollDeviceCode?(input: { deviceCode: string; interval: number; expiresAt: number }): Promise<OAuthCredential>
  refresh?(cred: OAuthCredential): Promise<OAuthCredential | null>
}
