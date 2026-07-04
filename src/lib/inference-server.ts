//
//   OpenAI:  POST http://127.0.0.1:<port>/v1/chat/completions   (+ GET /v1/models)
//   Ollama:  POST http://127.0.0.1:<port>/api/chat              (+ GET /api/tags)
//
import { invoke } from "@tauri-apps/api/core"

export interface InferenceServerSettings {
  enabled: boolean
  // Dinleme portu (default 1456).
  port: number
  expose: boolean
}

export const DEFAULT_INFERENCE_SERVER: InferenceServerSettings = {
  enabled: false,
  port: 1456,
  expose: false,
}

export interface InferenceServerStatus {
  running: boolean
  port: number
}

export async function startInferenceServer(port?: number, expose?: boolean): Promise<number> {
  return invoke<number>("inference_server_start", { port, expose })
}

export async function stopInferenceServer(): Promise<void> {
  await invoke("inference_server_stop")
}

export async function inferenceServerStatus(): Promise<InferenceServerStatus> {
  return invoke<InferenceServerStatus>("inference_server_status")
}

export async function syncInferenceServer(s: InferenceServerSettings | undefined): Promise<void> {
  try {
    if (s?.enabled) {
      await startInferenceServer(s.port, s.expose)
    } else {
      await stopInferenceServer()
    }
  } catch (e) {
    console.warn("[inference-server] senkron hatası:", e)
  }
}
