// models.dev/api.json — community-maintained provider/model katalogu (135 provider, 400+ model).
import type { CustomProvider, ProviderId } from "./providers"
import { contextCap, type Pricing } from "./pricing"

const CATALOG_URL = "https://models.dev/api.json"

export type ModelsDevModel = {
  id: string
  name?: string
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  knowledge?: string
  release_date?: string
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; output?: number }
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
    context_over_200k?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  }
  deprecated?: boolean
  // Per-model SDK/wire-format override (models.dev). Provider-seviyesi `npm`'i
  provider?: { npm?: string }
}

export type ModelsDevProvider = {
  id: string
  name: string
  npm?: string
  api?: string
  doc?: string
  env?: string[]
  models: Record<string, ModelsDevModel>
}

export type ProvidersCatalog = Record<string, ModelsDevProvider>

export type CachedCatalog = {
  data: ProvidersCatalog
  fetchedAt: number
}

const PROVIDER_ID_MAP: Partial<Record<ProviderId, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  openrouter: "openrouter",
  groq: "groq",
  mistral: "mistral",
  xai: "xai",
  perplexity: "perplexity",
  cohere: "cohere",
  cerebras: "cerebras",
  togetherai: "togetherai",
  deepinfra: "deepinfra",
  "github-copilot": "github-copilot",
  "amazon-bedrock": "amazon-bedrock",
  azure: "azure",
  "google-vertex": "google-vertex",
  vercel: "vercel",
  alibaba: "alibaba",
}

function modelsDevId(id: ProviderId): string {
  return PROVIDER_ID_MAP[id] ?? id
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export async function fetchProviderCatalog(): Promise<ProvidersCatalog> {
  const res = await fetch(CATALOG_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`models.dev fetch hatası: HTTP ${res.status}`)
  }
  const data = (await res.json()) as ProvidersCatalog
  if (typeof data !== "object" || !data) {
    throw new Error("models.dev: beklenmedik JSON şekli")
  }
  return data
}

// embedding/TTS/STT/image/moderation/realtime ses modelleri vs.
const NON_CHAT_PATTERNS = [
  /embed/i,
  /embedding/i,
  /whisper/i,
  /\btts\b/i,
  /text-to-speech/i,
  /speech-to-text/i,
  /-stt-/i,
  /moderation/i,
  /dall-?e/i,
  /image/i,
  /^gpt-image/i,
  /^omni-moderation/i,
  /-search-/i,
  /-realtime-/i,
  /-audio-preview/i,
  /-transcribe/i,
  /sora/i,
  /imagen/i,
  /veo/i,
  /^gemini-embedding/i,
]

function isChatCodingModel(m: ModelsDevModel): boolean {
  if (m.deprecated) return false
  // Bilinen non-chat pattern'lar
  if (NON_CHAT_PATTERNS.some((re) => re.test(m.id))) return false
  const name = m.name
  if (name && NON_CHAT_PATTERNS.some((re) => re.test(name))) return false
  const out = m.modalities?.output
  if (out && out.length > 0) {
    if (!out.includes("text")) return false
  }
  const inp = m.modalities?.input
  if (inp && inp.length > 0 && !inp.includes("text")) {
    return false
  }
  return true
}

// Deprecated + non-chat modeller (embedding/TTS/image/realtime vb.) elenir.
export function modelsForProvider(catalog: ProvidersCatalog | undefined, id: ProviderId): string[] {
  if (!catalog) return []
  const mdId = modelsDevId(id)
  const p = catalog[mdId]
  if (!p) return []
  const entries = Object.values(p.models).filter(isChatCodingModel)
  entries.sort((a, b) => {
    const da = a.release_date ?? ""
    const db = b.release_date ?? ""
    if (da && db && da !== db) return db.localeCompare(da)
    return a.id.localeCompare(b.id)
  })
  return entries.map((m) => m.id)
}

export function modelDetail(
  catalog: ProvidersCatalog | undefined,
  providerId: ProviderId,
  modelId: string,
): ModelsDevModel | null {
  if (!catalog) return null
  const mdId = modelsDevId(providerId)
  const p = catalog[mdId]
  if (!p) return null
  return p.models[modelId] ?? null
}

// models.dev is often stale for brand-new DashScope previews. Prefer explicit
// catalog modalities; fall back to name heuristics only when the catalog has
// nothing useful. QwenCloud docs (Token Plan Team) list several non-VL ids with
// "vision understanding" — keep those allowlisted so we don't strip images.
export function looksLikeVisionModel(modelId: string): boolean {
  const m = modelId.toLowerCase()
  // Explicit vision families. Avoid bare "max"/"plus" — those are often text-only.
  if (/(?:^|[-_./])(vl|vision|omni|qvq|vqa|vlm)(?:$|[-_./])/.test(m)) return true
  if (m.includes("multimodal") || m.includes("visual")) return true
  // Gemini / GPT-4o / Claude 3+ are multimodal by default even without "vl".
  if (/^gemini|^gpt-4o|^gpt-4\.1|^gpt-5|^o[1-9]|^claude-3|^claude-(sonnet|opus|haiku)-/.test(m)) {
    return true
  }
  return false
}

// Non-VL Qwen ids that still accept images (QwenCloud Token Plan / Model Studio).
// Keep this tight — "*-max" is NOT a vision signal (qwen3-max / qwen3.7-max are text-only).
export function isKnownVisionModel(modelId: string): boolean {
  const m = modelId.toLowerCase()
  if (looksLikeVisionModel(m)) return true
  // QwenCloud Team Edition: qwen3.8-max-preview = reasoning + vision understanding.
  if (/^qwen3\.8-max-preview(?:$|[-_/])/.test(m)) return true
  if (/^qwen3\.7-plus(?:$|[-_/])/.test(m)) return true
  if (/^qwen3\.6-(?:plus|flash)(?:$|[-_/])/.test(m)) return true
  // Qwen3.5 line is multimodal in Model Studio (text+image+video, often audio).
  if (/^qwen3\.5(?:$|[-_/])/.test(m)) return true
  return false
}

function isLikelyTextOnlyChatModel(_provider: ProviderId | undefined, modelId: string): boolean {
  if (isKnownVisionModel(modelId)) return false
  const m = modelId.toLowerCase()
  // Coder / code models almost never take images.
  if (/(?:^|[-_./])(coder|code)(?:$|[-_./])/.test(m)) return true
  if (m.includes("qwq")) return true
  // Explicit text-only Qwen chat max line (NOT qwen3.8-max-preview).
  if (/^qwen3-max(?:$|[-_/])/.test(m)) return true
  if (/^qwen3\.7-max(?:$|[-_/])/.test(m)) return true
  if (/^qwen3\.6-max(?:$|[-_/])/.test(m)) return true
  if (/^qwen-max(?:$|[-_/])/.test(m)) return true
  return false
}

export function modelAcceptsImages(
  catalog: ProvidersCatalog | undefined,
  provider: ProviderId | undefined,
  model: string,
): boolean {
  if (!provider) return true
  // Known vision ids win even when a stale catalog marks them text-only
  // (models.dev lagged qwen3.8-max-preview; QwenCloud already ships vision).
  if (isKnownVisionModel(model)) return true
  const inp = catalog ? modelDetail(catalog, provider, model)?.modalities?.input : undefined
  if (inp && inp.length > 0) return inp.includes("image")
  // No modality data: deny only known text-only families, else allow.
  if (isLikelyTextOnlyChatModel(provider, model)) return false
  return true
}

// Model PDF (document) girdisi destekliyor mu? — models.dev modalities.input "pdf".
export function modelAcceptsPdf(
  catalog: ProvidersCatalog | undefined,
  provider: ProviderId | undefined,
  model: string,
): boolean {
  if (!catalog || !provider) return false
  const inp = modelDetail(catalog, provider, model)?.modalities?.input
  if (!inp || inp.length === 0) return false
  return inp.includes("pdf")
}

export function resolveContextCap(
  catalog: ProvidersCatalog | undefined,
  provider: ProviderId | undefined,
  model: string,
  customProviders?: CustomProvider[],
): number {
  const customContextWindow = customProviders
    ?.find((candidate) => candidate.id === provider)
    ?.models.find((candidate) => candidate.id === model)?.contextWindow
  if (typeof customContextWindow === "number" && customContextWindow > 0) {
    return customContextWindow
  }
  if (catalog && provider) {
    const ctx = modelDetail(catalog, provider, model)?.limit?.context
    if (typeof ctx === "number" && ctx > 0) return ctx
  }
  return contextCap(model)
}

export function catalogPricing(
  catalog: ProvidersCatalog | undefined,
  provider: ProviderId | undefined,
  model: string,
): Pricing | null {
  if (!catalog || !provider) return null
  const c = modelDetail(catalog, provider, model)?.cost
  if (!c || (c.input == null && c.output == null)) return null
  const tier = c.context_over_200k
  return {
    inputPerMTok: c.input ?? 0,
    outputPerMTok: c.output ?? 0,
    cacheReadPerMTok: c.cache_read,
    cacheWritePerMTok: c.cache_write,
    contextOver200k: tier
      ? {
          inputPerMTok: tier.input ?? 0,
          outputPerMTok: tier.output ?? 0,
          cacheReadPerMTok: tier.cache_read,
          cacheWritePerMTok: tier.cache_write,
        }
      : undefined,
  }
}

// Cache stale mi?
export function isCatalogStale(cache: CachedCatalog | undefined): boolean {
  if (!cache) return true
  return Date.now() - cache.fetchedAt > STALE_AFTER_MS
}
