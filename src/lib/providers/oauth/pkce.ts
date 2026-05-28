// PKCE (RFC 7636) helper — code_verifier + code_challenge çifti üretir.
// OAuth 2.0 Authorization Code akışında client secret olmadan kimlik doğrulama
// için kullanılır. Codezal browser ortamında çalıştığı için crypto.subtle yeterli.

const VERIFIER_LEN = 64

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ""
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function generatePkcePair(): Promise<{
  verifier: string
  challenge: string
  method: "S256"
}> {
  const bytes = new Uint8Array(VERIFIER_LEN)
  crypto.getRandomValues(bytes)
  const verifier = base64UrlEncode(bytes.buffer)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(digest)
  return { verifier, challenge, method: "S256" }
}

// Rastgele state token — CSRF korunması.
export function generateState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes.buffer)
}
