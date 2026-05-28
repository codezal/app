// OAuth flow contracts.
// Codezal iki akışı destekler:
//   1. Authorization Code + PKCE (Anthropic Claude Pro/Max)
//      — `start()` browser açar, redirect URL kullanıcı tarafından `complete(url)`
//        ile yapıştırılır. Local HTTP listener şart değil.
//   2. Device Code (GitHub Copilot)
//      — `start()` user_code + verification_uri döner, kullanıcı browser'da
//        kodu girer. `complete()` polling yapıp token döner.
import type { OAuthCredential } from "../types"

export type OAuthStartResult =
  | {
      kind: "authCodePkce"
      authorizeUrl: string
      // Verifier client tarafında saklanır, complete() çağrısında geri verilir.
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
  // Akış adı — settings.credentials[providerId].meta.flow stamplenir.
  name: string
  // Başlat. Authorization Code akışında authorizeUrl döner; Device Code akışında
  // user_code + polling parametreleri.
  start(): Promise<OAuthStartResult>
  // Auth Code akışını tamamla: callback URL'i parse + token exchange.
  completeAuthCode?(input: { callbackUrl: string; state: string }): Promise<OAuthCredential>
  // Device flow polling.
  pollDeviceCode?(input: { deviceCode: string; interval: number; expiresAt: number }): Promise<OAuthCredential>
  // Refresh token ile yenile (varsa). null dönerse credential geçersiz.
  refresh?(cred: OAuthCredential): Promise<OAuthCredential | null>
}
