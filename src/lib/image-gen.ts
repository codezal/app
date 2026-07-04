// Image generation core for the `generate_image` tool.
//
// Two wire protocols, both POST JSON and return an image as base64 or a URL:
//   - openai-image : POST {base}/images/generations   → data[].b64_json | data[].url
//                    (OpenAI gpt-image + any OpenAI-compatible endpoint: zenmux,
//                     OpenRouter, DeepInfra, custom providers, …)
//   - minimax-image: POST {base}/v1/image_generation  → data.image_urls[] | data[].url
//
// The file is split into PURE helpers (endpoint/body/parse/base-url — unit-tested
// in node, no Tauri) and an IMPURE generateImage() that performs the HTTP calls
// through tauriFetch (Rust HTTP plugin → bypasses webview CORS, works on macOS +
// Windows). The API key never returns to the model; only the saved file path does.
import { tauriFetch } from "@/lib/providers/tauri-fetch"
import { getProviderAdapter, resolveAuth } from "@/lib/providers"
import type {
  ImageGenerationConfig,
  ImageGenerationProtocol,
  Settings,
} from "@/store/types"

export const DEFAULT_IMAGE_TIMEOUT_MS = 180_000
// providerId sentinel for "custom" (user-supplied baseUrl + key) vs. reusing a
// configured provider's credentials.
export const CUSTOM_IMAGE_PROVIDER_ID = "custom"

// Named image-generation presets. The settings UI exposes one dropdown
// (provider) — each preset fixes the wire protocol + default base URL, so the
// user never picks a protocol separately. The base URL is overridable (proxies,
// MiniMax regions). reuseProvider: when set and the user leaves the key blank, we
// reuse that built-in chat provider's stored API key (auth chain). MiniMax has no
// built-in chat provider, so its key is always entered here.
export type ImagePreset = {
  id: string
  label: string
  protocol: ImageGenerationProtocol
  baseUrl: string
  reuseProvider?: string
  defaultModel: string
}

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-image",
    baseUrl: "https://api.openai.com/v1",
    reuseProvider: "openai",
    defaultModel: "gpt-image-1",
  },
  {
    id: "gemini",
    label: "Gemini",
    protocol: "openai-image",
    // Google's OpenAI-compatible endpoint serves /images/generations (Imagen +
    // gemini image models).
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    reuseProvider: "google",
    defaultModel: "imagen-3.0-generate-002",
  },
  {
    id: "minimax",
    label: "MiniMax",
    protocol: "minimax-image",
    baseUrl: "https://api.minimax.io/v1",
    defaultModel: "image-01",
  },
]

// Look up a preset by id ("openai" | "gemini" | "minimax"). Returns undefined for
// the custom sentinel (or any unknown id) → caller treats it as custom mode.
export function imagePreset(id: string | undefined): ImagePreset | undefined {
  return IMAGE_PRESETS.find((p) => p.id === id)
}

// Is the model field a stock value (blank, or a preset's default) rather than one
// the user typed themselves? Used by the settings UI to decide whether switching
// providers may overwrite the model with the new preset's default.
export function isStockImageModel(model: string | undefined): boolean {
  const m = model?.trim()
  if (!m) return true
  return IMAGE_PRESETS.some((p) => p.defaultModel === m)
}

// Build the request URL for a protocol from a base URL. Defensive about whether
// the base already carries a version segment (…/v1) so we never double it.
export function imageEndpoint(protocol: ImageGenerationProtocol, base: string): string {
  const b = base.replace(/\/+$/, "")
  const hasVersion = /\/v\d+$/.test(b)
  if (protocol === "minimax-image") {
    return hasVersion ? `${b}/image_generation` : `${b}/v1/image_generation`
  }
  return hasVersion ? `${b}/images/generations` : `${b}/v1/images/generations`
}

// JSON request body per protocol. size is optional; "auto" / empty is omitted so
// the service picks its default. response_format is intentionally NOT sent for
// openai-image — gpt-image-1 rejects it (returns b64 by default) while DALL·E and
// most compatible endpoints still include a url/b64 field we parse defensively.
export function buildImageBody(
  protocol: ImageGenerationProtocol,
  model: string,
  prompt: string,
  size?: string,
): Record<string, unknown> {
  const trimmedSize = size?.trim()
  const useSize = trimmedSize && trimmedSize.toLowerCase() !== "auto" ? trimmedSize : undefined
  if (protocol === "minimax-image") {
    const body: Record<string, unknown> = { model, prompt, n: 1, response_format: "url" }
    if (useSize) body.aspect_ratio = useSize
    return body
  }
  const body: Record<string, unknown> = { model, prompt, n: 1 }
  if (useSize) body.size = useSize
  return body
}

export type ParsedImage = {
  // Inline base64 image (no scheme) — preferred when the API returns it directly.
  b64?: string
  // Remote URL the image must be fetched from (a second GET).
  remoteUrl?: string
  // Provider error message, if the response signalled a failure.
  error?: string
}

// Extract an image (b64 or url) from a parsed JSON response, tolerant of the
// small shape differences between OpenAI-compatible and MiniMax endpoints.
export function parseImageResult(
  protocol: ImageGenerationProtocol,
  json: unknown,
): ParsedImage {
  if (!json || typeof json !== "object") return { error: "Empty response" }
  const obj = json as Record<string, unknown>

  // Error shapes: OpenAI { error: { message } }; MiniMax { base_resp: { status_code, status_msg } }.
  const err = obj.error as { message?: string } | undefined
  if (err?.message) return { error: err.message }
  const baseResp = obj.base_resp as { status_code?: number; status_msg?: string } | undefined
  if (baseResp && baseResp.status_code !== undefined && baseResp.status_code !== 0) {
    return { error: baseResp.status_msg || `MiniMax status ${baseResp.status_code}` }
  }

  if (protocol === "minimax-image") {
    const data = obj.data as
      | { image_urls?: unknown; image_base64?: unknown }
      | Array<{ url?: unknown }>
      | undefined
    if (Array.isArray(data)) {
      const url = data[0]?.url
      if (typeof url === "string") return { remoteUrl: url }
    } else if (data) {
      const urls = data.image_urls
      if (Array.isArray(urls) && typeof urls[0] === "string") return { remoteUrl: urls[0] }
      const b64s = data.image_base64
      if (Array.isArray(b64s) && typeof b64s[0] === "string") return { b64: b64s[0] }
    }
    return { error: "MiniMax response had no image" }
  }

  // openai-image: { data: [ { b64_json } | { url } ] }
  const data = obj.data as Array<{ b64_json?: unknown; url?: unknown }> | undefined
  const first = Array.isArray(data) ? data[0] : undefined
  if (first) {
    if (typeof first.b64_json === "string") return { b64: first.b64_json }
    if (typeof first.url === "string") return { remoteUrl: first.url }
  }
  return { error: "Response had no image data" }
}

// Resolved, ready-to-call image config (preset credentials already looked up).
export type ResolvedImageGen = {
  protocol: ImageGenerationProtocol
  baseUrl: string
  apiKey: string
  model: string
  defaultSize?: string
  timeoutMs: number
}

// Either a callable config, or an error string (never both meaningful). Kept as a
// plain nullable pair rather than a discriminated union so consumers narrow on
// `resolved` directly without TS discriminant friction.
export type ResolveResult = { resolved: ResolvedImageGen | null; error: string | null }

// Turn the stored config into a callable one: custom mode uses the inline
// baseUrl/apiKey; preset mode reuses the chosen provider's key (via the auth
// chain: apiKey → env → oauth) and base URL. Returns a typed error instead of
// throwing so the tool gate and execute path can both reason about it.
export async function resolveImageGen(settings: Settings): Promise<ResolveResult> {
  const cfg = settings.imageGeneration
  if (!cfg || !cfg.enabled) return { resolved: null, error: "Image generation is disabled" }
  if (!cfg.model?.trim()) return { resolved: null, error: "No image model set" }

  const preset = imagePreset(cfg.providerId)
  if (preset) {
    // Base URL: user override (proxy / region) falls back to the preset default.
    const baseUrl = cfg.baseUrl?.trim() || preset.baseUrl
    // Key priority: explicit key entered here → else reuse the matching built-in
    // provider's key via the auth chain (apiKey → env → oauth).
    let apiKey = cfg.apiKey?.trim()
    if (!apiKey && preset.reuseProvider) {
      const catalog = settings.providerCatalog?.data as
        | Parameters<typeof getProviderAdapter>[1]
        | undefined
      const adapter = getProviderAdapter(preset.reuseProvider, catalog)
      if (adapter) {
        const auth = await resolveAuth(adapter, settings)
        if (auth.kind === "apiKey") apiKey = auth.value
        else if (auth.kind === "oauth") apiKey = auth.accessToken
      }
    }
    if (!apiKey) {
      return {
        resolved: null,
        error: `No API key — enter one or connect ${preset.label} in Providers`,
      }
    }
    return { resolved: makeResolved(cfg, preset.protocol, baseUrl, apiKey), error: null }
  }

  // Custom (OpenAI-compatible): inline base URL + key, openai-image protocol.
  const baseUrl = cfg.baseUrl?.trim()
  const apiKey = cfg.apiKey?.trim()
  if (!baseUrl) return { resolved: null, error: "Custom image API needs a base URL" }
  if (!apiKey) return { resolved: null, error: "Custom image API needs an API key" }
  return { resolved: makeResolved(cfg, "openai-image", baseUrl, apiKey), error: null }
}

function makeResolved(
  cfg: ImageGenerationConfig,
  protocol: ImageGenerationProtocol,
  baseUrl: string,
  apiKey: string,
): ResolvedImageGen {
  return {
    protocol,
    baseUrl,
    apiKey,
    model: cfg.model.trim(),
    defaultSize: cfg.defaultSize?.trim() || undefined,
    timeoutMs: cfg.timeoutMs && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_IMAGE_TIMEOUT_MS,
  }
}

export type GeneratedImage = { dataUrl: string; mime: string }

// Call the image API and return a base64 data URL. Performs up to two HTTP calls
// (generate, then GET a remote URL if the API returned one). Throws on any
// failure with a message safe to show the user (never includes the API key).
export async function generateImage(
  prompt: string,
  resolved: ResolvedImageGen,
  size?: string,
): Promise<GeneratedImage> {
  const url = imageEndpoint(resolved.protocol, resolved.baseUrl)
  const body = buildImageBody(
    resolved.protocol,
    resolved.model,
    prompt,
    size ?? resolved.defaultSize,
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), resolved.timeoutMs)
  let json: unknown
  try {
    const res = await tauriFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Image API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      const parsed = parseImageResult(resolved.protocol, json)
      throw new Error(parsed.error || `Image API error (HTTP ${res.status})`)
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Image request timed out after ${Math.round(resolved.timeoutMs / 1000)}s`, {
        cause: e,
      })
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  const parsed = parseImageResult(resolved.protocol, json)
  if (parsed.error) throw new Error(parsed.error)
  if (parsed.b64) {
    return { dataUrl: `data:image/png;base64,${parsed.b64}`, mime: "image/png" }
  }
  if (parsed.remoteUrl) return await fetchImageAsDataUrl(parsed.remoteUrl, resolved.timeoutMs)
  throw new Error("Image API returned no image")
}

// GET a remote image URL and convert to a base64 data URL. Uses tauriFetch so the
// request goes through the Rust side (the URL may be a signed CDN link the webview
// can't fetch under CSP). Base64 is built without fetch("data:") (Windows WebView2
// blocks that) — straight from the arrayBuffer bytes.
//
// Hardening (the URL comes from the image API's response, not the user): only
// follow http(s) — never file:/localhost-relative schemes — and require an
// image/* content-type, so a compromised endpoint can't turn this into an SSRF
// that downloads internal-service HTML and saves it as a fake "image".
async function fetchImageAsDataUrl(remoteUrl: string, timeoutMs: number): Promise<GeneratedImage> {
  if (!/^https?:\/\//i.test(remoteUrl)) {
    throw new Error("Image URL must be http(s)")
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await tauriFetch(remoteUrl, { signal: controller.signal })
    if (!res.ok) throw new Error(`Could not download generated image (HTTP ${res.status})`)
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || ""
    if (!mime.startsWith("image/")) {
      throw new Error(`Expected an image, got ${mime || "unknown content-type"}`)
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    return { dataUrl: `data:${mime};base64,${bytesToBase64(buf)}`, mime }
  } finally {
    clearTimeout(timer)
  }
}

// Uint8Array → base64. Chunked to avoid blowing the call-stack on large images
// (String.fromCharCode(...wholeArray) overflows for multi-MB buffers).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
