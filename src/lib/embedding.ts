// Provider-agnostik embedding API.
// OpenAI uyumlu /v1/embeddings endpoint ile (gerçek OpenAI veya Ollama'nın OpenAI uyumlu portu).
//
// Ollama yerel: http://localhost:11434/v1 + model nomic-embed-text. API key gereksiz.
// OpenAI: https://api.openai.com/v1 + text-embedding-3-small + Authorization Bearer.
// Custom: kullanıcı baseUrl + model + opsiyonel key.

export type EmbeddingProvider = "openai" | "ollama" | "custom"

export type EmbeddingConfig = {
  provider: EmbeddingProvider
  baseUrl?: string
  model: string
  apiKey?: string
}

const DEFAULT_BASE: Record<EmbeddingProvider, string> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  custom: "",
}

function resolveBase(cfg: EmbeddingConfig): string {
  const b = cfg.baseUrl || DEFAULT_BASE[cfg.provider]
  if (!b) throw new Error("Embedding baseUrl eksik (custom provider için zorunlu)")
  return b.replace(/\/+$/, "")
}

// Tek batch isteği — input string array, döndürür number[][] (her embedding).
async function embedBatch(cfg: EmbeddingConfig, input: string[]): Promise<number[][]> {
  if (input.length === 0) return []
  const url = resolveBase(cfg) + "/embeddings"
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: cfg.model, input }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Embedding API hatası: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>
  }
  if (!Array.isArray(json.data)) throw new Error("Embedding API yanıtı beklenmedik")
  // index sırasına göre sırala — bazı sağlayıcılar karışık döner
  const sorted = [...json.data].sort((a, b) => a.index - b.index)
  return sorted.map((d) => d.embedding)
}

// Büyük listeyi batch'lere böl, sırayla işle, hepsini birleştir.
// progress: 0..1, opsiyonel.
export async function embedMany(
  cfg: EmbeddingConfig,
  inputs: string[],
  batchSize = 64,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize)
    const part = await embedBatch(cfg, slice)
    out.push(...part)
    onProgress?.(Math.min(i + batchSize, inputs.length), inputs.length)
  }
  return out
}

// Cosine similarity — pre-normalized değil, her seferinde norm hesaplar.
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom === 0) return 0
  return dot / denom
}
