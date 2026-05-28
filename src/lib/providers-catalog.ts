// models.dev/api.json — community-maintained provider/model katalogu (135 provider, 400+ model).
// Codezal şu an 4 provider için npm paketi yüklü (openai, anthropic, google, deepseek).
// Bu katalogdan SADECE model listesini dinamik çekiyoruz; provider eklemek ekstra npm paket ister.
// Cache: settings.providerCatalog. Refresh: kullanıcı manuel veya 7+ gün eski ise otomatik.
import type { ProviderId } from "./providers"

const CATALOG_URL = "https://models.dev/api.json"

// models.dev şema parçası — kullandığımız alanlar.
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
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  // Bazı providerlar deprecated flag verir
  deprecated?: boolean
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

// Persistable cache — settings'te saklanır
export type CachedCatalog = {
  data: ProvidersCatalog
  fetchedAt: number
}

// Codezal ProviderId → models.dev provider id eşlemesi.
// Partial: bilinmeyen id'ler için provider id'sini olduğu gibi kullan.
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

// 24 saat ile bayatlık eşiği
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

// Tauri webview üzerinden direkt fetch — models.dev CORS allow eder (statik JSON).
// Hata olursa fallback hardcoded listeye geri dön (caller hallediyor).
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

// Programlama görevine uygun olmayan model id pattern'ları —
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

// Chat/coding modeli mi? — id pattern + modalite kontrolü.
function isChatCodingModel(m: ModelsDevModel): boolean {
  if (m.deprecated) return false
  // Bilinen non-chat pattern'lar
  if (NON_CHAT_PATTERNS.some((re) => re.test(m.id))) return false
  const name = m.name
  if (name && NON_CHAT_PATTERNS.some((re) => re.test(name))) return false
  // Modalite varsa: çıktı text içermeli, sadece audio/image çıkışı olmamalı
  const out = m.modalities?.output
  if (out && out.length > 0) {
    if (!out.includes("text")) return false
    // Sadece ses/görüntü çıktısı varsa text yoksa zaten elendi; text varsa multi-modal OK
  }
  const inp = m.modalities?.input
  if (inp && inp.length > 0 && !inp.includes("text")) {
    // Text girdisi alamayan model chat değil
    return false
  }
  return true
}

// Katalogdan bir provider'ın chat/coding modeli id listesini çıkar.
// Deprecated + non-chat modeller (embedding/TTS/image/realtime vb.) elenir.
// release_date varsa yenilik sırasıyla sıralanır.
export function modelsForProvider(catalog: ProvidersCatalog | undefined, id: ProviderId): string[] {
  if (!catalog) return []
  const mdId = modelsDevId(id)
  const p = catalog[mdId]
  if (!p) return []
  const entries = Object.values(p.models).filter(isChatCodingModel)
  entries.sort((a, b) => {
    // Yenisi önce — release_date varsa onunla, yoksa id alfabetik
    const da = a.release_date ?? ""
    const db = b.release_date ?? ""
    if (da && db && da !== db) return db.localeCompare(da)
    return a.id.localeCompare(b.id)
  })
  return entries.map((m) => m.id)
}

// Tek model için detay — pricing/context limiti vs UI'da gösterilebilir
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

// Cache stale mi?
export function isCatalogStale(cache: CachedCatalog | undefined): boolean {
  if (!cache) return true
  return Date.now() - cache.fetchedAt > STALE_AFTER_MS
}
