// GitHub Copilot — OAuth device flow + openai-compatible endpoint.
// API token cred.accessToken'da; meta.endpoint Copilot proxy URL'i (refresh edilir).
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const githubCopilotAdapter: ProviderAdapter = {
  id: "github-copilot",
  label: "GitHub Copilot",
  popular: true,
  authMethods: ["oauth"],
  envVars: [],
  npmPackage: "@ai-sdk/openai-compatible",
  oauthName: "github-copilot",
  defaultModel: "claude-sonnet-4-6",
  fallbackModels: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gemini-3.1-pro",
    "o4-mini",
  ],
  recommendedModels: ["claude-sonnet-4-6", "gpt-5.4-mini", "gemini-3.1-pro"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "oauth") throw new Error("GitHub Copilot: OAuth sign-in required")
    const endpoint =
      (config?.options?.endpoint as string | undefined) ?? "https://api.githubcopilot.com"
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    return factory({
      name: "github-copilot",
      apiKey: auth.accessToken,
      baseURL: endpoint,
      headers: {
        "Editor-Version": "Codezal/1.0",
        "Copilot-Integration-Id": "codezal",
        "Openai-Intent": "conversation-panel",
        ...(config?.headers ?? {}),
      },
    })(modelId) as LanguageModel
  },
}
