// Amazon Bedrock — AWS hostlu LLM marketplace.
// region tutar.
import { loadProviderFactory } from "./lazy-sdk"
import { readEnvVar } from "./env-reader"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const amazonBedrockAdapter: ProviderAdapter = {
  id: "amazon-bedrock",
  label: "Amazon Bedrock",
  authMethods: ["apiKey", "env"],
  envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
  npmPackage: "@ai-sdk/amazon-bedrock",
  requiresConfig: true,
  defaultModel: "anthropic.claude-sonnet-4-6-v1:0",
  fallbackModels: [
    "anthropic.claude-opus-4-7-v1:0",
    "anthropic.claude-sonnet-4-6-v1:0",
    "anthropic.claude-haiku-4-5-v1:0",
    "meta.llama4-maverick-17b-instruct-v1:0",
    "mistral.mistral-large-2407-v1:0",
    "amazon.nova-pro-v1:0",
  ],
  recommendedModels: ["anthropic.claude-sonnet-4-6-v1:0", "amazon.nova-pro-v1:0"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Amazon Bedrock: AWS credentials required")
    // The stored/env value may be "AK:SK" (apiKey form) or JUST the access key
    // (env form — resolveAuth returns only the first matching envVar, i.e.
    // AWS_ACCESS_KEY_ID, so the secret never rides along in auth.value) (M22).
    let accessKeyId: string | undefined
    let secretAccessKey: string | undefined
    if (auth.value.includes(":")) {
      const idx = auth.value.indexOf(":")
      accessKeyId = auth.value.slice(0, idx)
      secretAccessKey = auth.value.slice(idx + 1)
    } else {
      accessKeyId = auth.value
    }
    // Fill any missing piece from the environment.
    if (!accessKeyId) accessKeyId = (await readEnvVar("AWS_ACCESS_KEY_ID")) ?? undefined
    if (!secretAccessKey) secretAccessKey = (await readEnvVar("AWS_SECRET_ACCESS_KEY")) ?? undefined
    const region =
      (config?.options?.region as string | undefined) ??
      (await readEnvVar("AWS_REGION")) ??
      "us-east-1"
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "Bedrock: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY required (apiKey 'AK:SK' or env vars)",
      )
    }
    const factory = await loadProviderFactory("@ai-sdk/amazon-bedrock")
    return factory({
      accessKeyId,
      secretAccessKey,
      region,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
