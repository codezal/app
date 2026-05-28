// Amazon Bedrock — AWS hostlu LLM marketplace.
// Auth: AWS Access Key ID + Secret + Region. Codezal apiKey alanını
// "AWS_ACCESS_KEY_ID:AWS_SECRET_ACCESS_KEY" formatında bekler; config.options
// region tutar.
import { loadProviderFactory } from "./lazy-sdk"
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
    const [accessKeyId, secretAccessKey] = auth.value.split(":", 2)
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Bedrock: apiKey must be 'AWS_ACCESS_KEY_ID:AWS_SECRET_ACCESS_KEY'")
    }
    const region = (config?.options?.region as string | undefined) ?? "us-east-1"
    const factory = await loadProviderFactory("@ai-sdk/amazon-bedrock")
    return factory({
      accessKeyId,
      secretAccessKey,
      region,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
