// Provider resolution for the bench harness — catalog-driven.
//
// Any provider id from the app's model catalog (src/lib/catalog-snapshot.json)
// works as long as credentials are available:
//
//   npm run bench -- --provider kimi-for-coding --model k2p6
//   npm run bench -- --list                      # registered (credentialed) providers
//
// API key resolution (see bench/runtime/credentials.ts):
//   BENCH_API_KEY → provider env var (from the catalog) → OS keychain entry
//   written by the desktop app (service "codezal", account "apiKey.<id>").
//
// Env remains supported for CI: BENCH_PROVIDER + BENCH_MODEL select the agent
// model; OPTIMIZER_PROVIDER / OPTIMIZER_MODEL fall back to the BENCH_* pair.
// BENCH_BASE_URL overrides the catalog endpoint for the selected provider.
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createXai } from "@ai-sdk/xai"
import { createGroq } from "@ai-sdk/groq"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { listKeychainApiKeyIds, resolveApiKey } from "./credentials"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CATALOG_PATH = path.join(REPO_ROOT, "src/lib/catalog-snapshot.json")
// The desktop app caches its live-fetched models.dev catalog here. It carries
// providers/models newer than the bundled snapshot (e.g. alibaba-token-plan,
// kimi-for-coding k3), so prefer it when present. macOS path; on other
// platforms the read simply fails and we fall back to the snapshot.
const APP_SETTINGS_PATH = path.join(
  os.homedir(),
  "Library/Application Support/app.codezal.desktop/settings.json",
)

export interface ModelRef {
  provider: string
  model: string
}

interface CatalogProvider {
  name?: string
  npm?: string
  api?: string
  env?: string[]
  models?: Record<string, unknown>
}

// Convenience aliases for ids that were renamed in the catalog.
const ALIASES: Record<string, string> = {
  moonshot: "moonshotai",
  "kimi": "kimi-for-coding",
}

let catalogCache: Record<string, CatalogProvider> | null = null

async function loadCatalog(): Promise<Record<string, CatalogProvider>> {
  if (catalogCache) return catalogCache
  // Prefer the app's live-fetched catalog; fall back to the bundled snapshot.
  try {
    const settings = JSON.parse(await fs.readFile(APP_SETTINGS_PATH, "utf8")) as {
      providerCatalog?: { data?: Record<string, CatalogProvider> }
    }
    const live = settings.providerCatalog?.data
    if (live && Object.keys(live).length > 0) {
      catalogCache = live
      return catalogCache
    }
  } catch {
    // App settings missing/unreadable — use the bundled snapshot below.
  }
  const raw = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8")) as {
    providers?: Record<string, CatalogProvider>
  }
  catalogCache = raw.providers ?? (raw as unknown as Record<string, CatalogProvider>)
  return catalogCache
}

function buildModel(
  npm: string | undefined,
  opts: { id: string; apiKey: string; baseURL?: string; model: string },
): LanguageModel {
  const { id, apiKey, baseURL, model } = opts
  switch (npm) {
    case "@ai-sdk/openai":
      return createOpenAI({ apiKey, baseURL })(model)
    case "@ai-sdk/anthropic":
      return createAnthropic({ apiKey, baseURL })(model)
    case "@ai-sdk/google":
      return createGoogleGenerativeAI({ apiKey, baseURL })(model)
    case "@ai-sdk/openai-compatible":
      if (!baseURL) throw new Error(`Provider "${id}" needs a base URL (catalog has none).`)
      return createOpenAICompatible({ name: id, apiKey, baseURL })(model)
    case "@openrouter/ai-sdk-provider":
      return createOpenRouter({ apiKey, baseURL })(model)
    case "@ai-sdk/deepseek":
      return createDeepSeek({ apiKey, baseURL })(model)
    case "@ai-sdk/xai":
      return createXai({ apiKey, baseURL })(model)
    case "@ai-sdk/groq":
      return createGroq({ apiKey, baseURL })(model)
    case "@ai-sdk/mistral":
      return createMistral({ apiKey, baseURL })(model)
    default:
      throw new Error(
        `Provider "${id}" uses SDK "${npm ?? "(none)"}" which the bench does not support yet — ` +
          `add a factory in bench/runtime/provider.ts.`,
      )
  }
}

// Resolved models are cached per process: the keychain read happens once, so
// a transient keychain hiccup (or the macOS access prompt) can only affect the
// preflight call, never a task in the middle of a suite.
const modelCache = new Map<string, LanguageModel>()

export async function resolveModel(ref: ModelRef): Promise<LanguageModel> {
  const catalog = await loadCatalog()
  const id = ALIASES[ref.provider] ?? ref.provider
  const entry = catalog[id]
  if (!entry) {
    throw new Error(
      `Unknown provider "${ref.provider}" — not in the model catalog. ` +
        `Run \`npm run bench -- --list\` to see registered providers.`,
    )
  }
  const baseURL = process.env.BENCH_BASE_URL ?? entry.api ?? undefined
  const cacheKey = `${id}/${ref.model}/${baseURL ?? ""}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached
  const auth = await resolveApiKey(id, entry.env ?? [])
  if (!auth) {
    const envHint = entry.env?.length ? ` or set ${entry.env.join(" / ")}` : ""
    throw new Error(
      `No API key found for "${id}" — add it in the Codezal app (stored in the OS keychain)${envHint}.`,
    )
  }
  const model = buildModel(entry.npm, { id, apiKey: auth.value, baseURL, model: ref.model })
  modelCache.set(cacheKey, model)
  return model
}

export interface RegisteredProvider {
  id: string
  name: string
  auth: "env" | "keychain"
  authDetail: string
  models: string[]
}

// Providers usable RIGHT NOW: catalog entry + credentials (env or keychain).
export async function listRegisteredProviders(): Promise<RegisteredProvider[]> {
  const catalog = await loadCatalog()
  const keychainIds = new Set(await listKeychainApiKeyIds())
  const out: RegisteredProvider[] = []
  for (const [id, entry] of Object.entries(catalog)) {
    const envHit = (entry.env ?? []).find((e) => !!process.env[e])
    const auth = envHit
      ? ({ kind: "env", detail: envHit } as const)
      : keychainIds.has(id)
        ? ({ kind: "keychain", detail: `apiKey.${id}` } as const)
        : null
    if (!auth) continue
    out.push({
      id,
      name: entry.name ?? id,
      auth: auth.kind,
      authDetail: auth.detail,
      models: Object.keys(entry.models ?? {}).slice(0, 6),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function benchModelRef(): ModelRef {
  const provider = process.env.BENCH_PROVIDER
  const model = process.env.BENCH_MODEL
  if (!provider || !model) {
    throw new Error(
      "Select a model: --provider <id> --model <id> (see --list), " +
        "or set BENCH_PROVIDER + BENCH_MODEL.",
    )
  }
  return { provider, model }
}

export function optimizerModelRef(): ModelRef {
  const fallback = benchModelRef()
  return {
    provider: process.env.OPTIMIZER_PROVIDER ?? fallback.provider,
    model: process.env.OPTIMIZER_MODEL ?? fallback.model,
  }
}
