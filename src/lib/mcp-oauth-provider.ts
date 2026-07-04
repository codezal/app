// MCP OAuth client provider — implements the SDK's OAuthClientProvider so the
// StreamableHTTP/SSE transports can perform the full OAuth 2.1 flow:
// metadata discovery, dynamic client registration (RFC 7591), PKCE, the
// authorization-code grant, and silent token refresh. Credentials are persisted
// through mcp-auth.ts (AppData/mcp-auth.json). The only piece this provider
// cannot do headlessly is opening the browser; that is delegated to `onRedirect`.
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import {
  getAuth,
  getAuthForUrl,
  removeAuth,
  setAuth,
  updateClientInfo,
  updateCodeVerifier,
  updateOAuthState,
  updateTokens,
} from "./mcp-auth"

// Default loopback redirect. Nothing actually listens on it — codezal captures
// the authorization code by having the user paste back the redirected URL (the
// browser lands on a dead page but the address bar holds ?code=...&state=...).
export const OAUTH_CALLBACK_PORT = 19876
export const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

export interface McpOAuthOptions {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export interface McpOAuthCallbacks {
  // Called with the provider-built authorization URL the user must visit.
  onRedirect: (url: URL) => void | Promise<void>
}

export class CodezalMcpOAuthProvider implements OAuthClientProvider {
  private mcpName: string
  private serverUrl: string
  private options: McpOAuthOptions
  private callbacks: McpOAuthCallbacks

  constructor(
    mcpName: string,
    serverUrl: string,
    options: McpOAuthOptions,
    callbacks: McpOAuthCallbacks,
  ) {
    this.mcpName = mcpName
    this.serverUrl = serverUrl
    this.options = options
    this.callbacks = callbacks
  }

  get redirectUrl(): string {
    if (this.options.redirectUri) return this.options.redirectUri
    const port = this.options.callbackPort ?? OAUTH_CALLBACK_PORT
    return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "Codezal",
      client_uri: "https://www.codezal.com",
      logo_uri: "https://www.codezal.com/assets/codezal-icon-red-1024.png",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.options.clientSecret ? "client_secret_post" : "none",
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Pre-registered client from user config wins.
    if (this.options.clientId) {
      return { client_id: this.options.clientId, client_secret: this.options.clientSecret }
    }
    // Otherwise reuse a dynamically-registered client, but only if it was issued
    // for the current server URL and its secret hasn't expired.
    const entry = await getAuthForUrl(this.mcpName, this.serverUrl)
    if (entry?.clientInfo) {
      const { clientSecretExpiresAt } = entry.clientInfo
      if (clientSecretExpiresAt && clientSecretExpiresAt < Date.now() / 1000) return undefined
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret,
      }
    }
    // undefined → SDK performs dynamic client registration.
    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await updateClientInfo(
      this.mcpName,
      {
        clientId: info.client_id,
        clientSecret: info.client_secret,
        clientIdIssuedAt: info.client_id_issued_at,
        clientSecretExpiresAt: info.client_secret_expires_at,
      },
      this.serverUrl,
    )
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await getAuthForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined
    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await updateTokens(
      this.mcpName,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
        scope: tokens.scope,
      },
      this.serverUrl,
    )
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await updateCodeVerifier(this.mcpName, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await getAuth(this.mcpName)
    if (!entry?.codeVerifier) {
      throw new Error(`No PKCE code verifier saved for MCP server: ${this.mcpName}`)
    }
    return entry.codeVerifier
  }

  async saveState(state: string): Promise<void> {
    await updateOAuthState(this.mcpName, state)
  }

  async state(): Promise<string> {
    const entry = await getAuth(this.mcpName)
    if (entry?.oauthState) return entry.oauthState
    // The SDK treats state() as a generator, not just a reader — produce and
    // persist a fresh CSRF token when none exists yet.
    const fresh = randomState()
    await updateOAuthState(this.mcpName, fresh)
    return fresh
  }

  async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    const entry = await getAuth(this.mcpName)
    if (!entry) return
    switch (type) {
      case "all":
        await removeAuth(this.mcpName)
        break
      case "client":
        delete entry.clientInfo
        await setAuth(this.mcpName, entry)
        break
      case "tokens":
        delete entry.tokens
        await setAuth(this.mcpName, entry)
        break
    }
  }
}

// 32-byte hex CSRF state.
export function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
