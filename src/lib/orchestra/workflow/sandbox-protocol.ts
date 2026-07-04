
// ── Worker → Host (worker'dan istek / olay) ──────────────────────────────────────
export type WorkerToHost =
  | { t: "agent"; id: number; prompt: string; opts: unknown }
  | { t: "wf"; id: number; ref: unknown }
  | { t: "log"; msg: string } // log() — fire-and-forget
  | { t: "phase"; title: string } // phase() — fire-and-forget
  | { t: "done"; result: unknown } // script bitti
  | { t: "fail"; error: string } // script throw etti

export type HostToWorker =
  | { t: "start"; script: string; args: unknown; budgetTotal: number | null }
  | { t: "agentRes"; id: number; ok: boolean; value?: unknown; error?: string; spent: number }
  | { t: "wfRes"; id: number; ok: boolean; script?: string; error?: string }

export const NEUTRALIZED_GLOBALS: readonly string[] = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "Request",
  "Response",
  "Headers",
  "navigator", // sendBeacon / userAgent fingerprint
  "indexedDB",
  "caches",
  "BroadcastChannel",
]

export function neutralizeGlobals(scope: Record<string, unknown>): void {
  for (const name of NEUTRALIZED_GLOBALS) {
    try {
      scope[name] = undefined
    } catch {
      // Intentionally ignored.
    }
  }
}
