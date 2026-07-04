import { tauriFetch } from "./tauri-fetch"

export type LocalPreset = {
  id: string
  name: string
  baseURL: string
}

export const LOCAL_PRESETS: LocalPreset[] = [
  { id: "ollama", name: "Ollama (local)", baseURL: "http://localhost:11434/v1" },
  { id: "lmstudio", name: "LM Studio (local)", baseURL: "http://127.0.0.1:1234/v1" },
]

type ModelsResponse = { data?: Array<{ id?: unknown }> }

export async function probeModels(
  baseURL: string,
  opts?: { apiKey?: string; headers?: Record<string, string>; timeoutMs?: number },
): Promise<string[]> {
  const base = baseURL.trim().replace(/\/+$/, "")
  if (!base) throw new Error("baseURL required")
  const headers: Record<string, string> = { ...opts?.headers }
  const key = opts?.apiKey?.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  const res = await tauriFetch(`${base}/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 5000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as ModelsResponse
  const ids = (json.data ?? [])
    .map((m) => (typeof m?.id === "string" ? m.id.trim() : ""))
    .filter(Boolean)
  return Array.from(new Set(ids)).sort()
}
