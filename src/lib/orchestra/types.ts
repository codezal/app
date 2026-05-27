// Orkestra modu — worker havuzu konfigürasyonu ve runtime tipleri.
// Parent LLM (aktif session modeli) `dispatch_workers` tool'u ile bu havuzdaki
// worker'lara paralel görev dağıtır.
import type { ProviderId } from "../providers"

// Worker tipi — hangi runtime üzerinden çalışacak
export type WorkerKind = "sdk" | "claude-cli" | "codex-cli" | "opencode-cli"

// Tek worker tanımı (havuz konfigürasyonunda).
// idx 1-5 arası, parent LLM dispatch ederken bu indeksi kullanır.
// Worker'ın görevi parent tarafından runtime'da verilir; preset varsa AgentDef'ten
// system prompt + policy gelir, yoksa generic worker prompt'u kullanılır.
export type WorkerConfig = {
  idx: number
  kind: WorkerKind
  // SDK için zorunlu; CLI için göstergesel (gerçek model CLI tarafında belirlenir)
  provider?: ProviderId
  model?: string
  // YOLO modu — tool çağrılarına otomatik onay (SDK için bypass, CLI için kendi flag'i)
  yolo: boolean
  // Preset bir AgentDef adı — varsa onun system prompt + policy'si kullanılır (SDK)
  presetAgent?: string
  // Etiket — UI'da gösterilir; boşsa "worker-N: <kind> · <model>" otomatik
  label?: string
}

// Aktif session'a iliştirilen orkestra konfigürasyonu
export type OrchestraConfig = {
  // Parent LLM — default = aktif session.provider/model. Override edilebilir.
  parentProvider: ProviderId
  parentModel: string
  // 1..5 worker tanımı
  workers: WorkerConfig[]
  // Worker stdout/stderr UI buffer satır limiti — ring buffer
  logBufferLines?: number
}

// dispatch_workers tool execute sonucu — parent context'e geri döner
export type WorkerDispatchResult = {
  workerIdx: number
  workerId: string
  status: "done" | "error" | "aborted"
  output: string
  tokensIn?: number
  tokensOut?: number
  errorMessage?: string
  durationMs: number
}

// AgentCard parçası — message.parts[] içinde tek bir worker'ın canlı durumunu temsil eder.
// Bu tip Part union'a (store/types.ts) eklenir.
export type AgentCardStatus =
  | "pending"
  | "running"
  | "waiting-approval"
  | "done"
  | "error"
  | "aborted"

export type AgentCardToolCall = {
  name: string
  status: "running" | "done" | "error"
}

export type AgentCardPart = {
  type: "agent-card"
  workerId: string
  workerIdx: number
  // Bu workerIdx'in kaçıncı dispatch'i — UI'da "görev-N" gösterimi için.
  // İlk spawn 1, aynı slot tekrar dispatch edilirse 2, 3, ...
  taskNum: number
  workerLabel: string
  kind: WorkerKind
  // Konfig snapshot — sonradan reference için (config silinmiş olabilir)
  configSnapshot: Pick<
    WorkerConfig,
    "kind" | "provider" | "model" | "yolo" | "presetAgent"
  >
  status: AgentCardStatus
  // Ring buffer — son N satır canlı stdout/stream çıktısı
  outputLog: string[]
  // Aktif/biten tool çağrıları (özet)
  toolCalls?: AgentCardToolCall[]
  // Final text özet (worker bitince doldurulur)
  finalText?: string
  tokensIn?: number
  tokensOut?: number
  startedAt?: number
  finishedAt?: number
  errorMessage?: string
}

// Worker runtime için ortak event tipi — tüm runner'lar bunu emit eder.
// dispatchWorkers runtime'ı patch'e dönüştürür.
export type WorkerEvent =
  | { type: "started" }
  | { type: "log"; line: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; name: string; id?: string }
  | { type: "tool-result"; name: string; id?: string; isError?: boolean }
  | { type: "usage"; tokensIn?: number; tokensOut?: number }
  | { type: "waiting-approval"; toolName: string }
  | { type: "complete"; text: string }
  | { type: "error"; message: string }
  | { type: "aborted" }

// Runner ortak interface — her worker tipi bunu döner
export type WorkerHandle = {
  workerId: string
  abort: () => void
  // Promise — worker bitene kadar resolve etmez. Bittiğinde final result.
  done: Promise<WorkerDispatchResult>
}

// Runner factory — config + task + emitter → handle
export type RunnerStart = (input: {
  workerId: string
  config: WorkerConfig
  task: string
  workspacePath?: string
  emit: (event: WorkerEvent) => void
  signal: AbortSignal
}) => Promise<{ done: Promise<WorkerDispatchResult> }>
