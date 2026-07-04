//
// olarak tauriFetch enjekte edilir.
import { tauriFetch } from "./tauri-fetch"

type ProviderFactory = (opts: Record<string, unknown>) => (modelId: string) => unknown

// Provider SDK paketleri — her biri `create*` factory'sini export eder.
const LOADERS: Record<string, () => Promise<ProviderFactory>> = {
  "@ai-sdk/anthropic": () =>
    import("@ai-sdk/anthropic").then((m) => m.createAnthropic as unknown as ProviderFactory),
  "@ai-sdk/amazon-bedrock": () =>
    import("@ai-sdk/amazon-bedrock").then((m) => m.createAmazonBedrock as unknown as ProviderFactory),
  "@ai-sdk/azure": () =>
    import("@ai-sdk/azure").then((m) => m.createAzure as unknown as ProviderFactory),
  "@ai-sdk/cerebras": () =>
    import("@ai-sdk/cerebras").then((m) => m.createCerebras as unknown as ProviderFactory),
  "@ai-sdk/cohere": () =>
    import("@ai-sdk/cohere").then((m) => m.createCohere as unknown as ProviderFactory),
  "@ai-sdk/deepinfra": () =>
    import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra as unknown as ProviderFactory),
  "@ai-sdk/google-vertex": () =>
    import("@ai-sdk/google-vertex").then((m) => m.createVertex as unknown as ProviderFactory),
  "@ai-sdk/groq": () =>
    import("@ai-sdk/groq").then((m) => m.createGroq as unknown as ProviderFactory),
  "@ai-sdk/mistral": () =>
    import("@ai-sdk/mistral").then((m) => m.createMistral as unknown as ProviderFactory),
  "@ai-sdk/openai-compatible": () =>
    import("@ai-sdk/openai-compatible").then(
      (m) => m.createOpenAICompatible as unknown as ProviderFactory,
    ),
  "@ai-sdk/perplexity": () =>
    import("@ai-sdk/perplexity").then((m) => m.createPerplexity as unknown as ProviderFactory),
  "@ai-sdk/togetherai": () =>
    import("@ai-sdk/togetherai").then((m) => m.createTogetherAI as unknown as ProviderFactory),
  "@ai-sdk/vercel": () =>
    import("@ai-sdk/vercel").then((m) => m.createVercel as unknown as ProviderFactory),
  "@ai-sdk/xai": () =>
    import("@ai-sdk/xai").then((m) => m.createXai as unknown as ProviderFactory),
  "@openrouter/ai-sdk-provider": () =>
    import("@openrouter/ai-sdk-provider").then(
      (m) => m.createOpenRouter as unknown as ProviderFactory,
    ),
}

const cache = new Map<string, ProviderFactory>()

export async function loadProviderFactory(pkg: string): Promise<ProviderFactory> {
  const cached = cache.get(pkg)
  if (cached) return cached
  const loader = LOADERS[pkg]
  if (!loader) throw new Error(`Unsupported provider SDK: ${pkg}`)
  const raw = await loader()
  const wrapped: ProviderFactory = (opts) =>
    raw({ fetch: tauriFetch, ...opts })
  cache.set(pkg, wrapped)
  return wrapped
}
