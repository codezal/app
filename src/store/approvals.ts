// Tool approval queue — model bir tool çağırmadan önce request edilir.
// UI ApprovalModal kuyruğu render eder; karar verilince Promise resolve olur.
import { create } from "zustand"
import { useSettingsStore } from "./settings"
import type { ApprovalDecision, ApprovalRule } from "./types"

export type { ApprovalDecision, ApprovalRule } from "./types"

export type ApprovalRequest = {
  id: string
  tool: string
  input: unknown
  // Worker context — orkestra modunda hangi worker tool'u çağırıyor (etiket için)
  workerLabel?: string
  // Decide(decision) çağrılınca queue'dan düşer
  resolve: (d: ApprovalDecision) => void
}

type ApprovalsState = {
  queue: ApprovalRequest[]
  // Bypass aktif worker ID'leri — orkestra modunda YOLO=true worker'lar burada
  bypassWorkerIds: Set<string>
  request: (
    tool: string,
    input: unknown,
    opts?: { workerId?: string; workerLabel?: string },
  ) => Promise<ApprovalDecision>
  decide: (id: string, decision: ApprovalDecision) => void
  // Worker bypass set yönetimi
  addBypassWorker: (workerId: string) => void
  removeBypassWorker: (workerId: string) => void
  clearBypassWorkers: () => void
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  queue: [],
  bypassWorkerIds: new Set<string>(),

  request: (tool, input, opts) => {
    // Worker-scoped YOLO bypass — orkestra worker'ı YOLO=true ise direkt allow.
    // opts.workerId verilmişse spesifik worker kontrolü; verilmemişse global "herhangi YOLO worker aktif mi" kontrolü.
    // MVP not: çağırma tarafı workerId iletemediğinde, herhangi bir YOLO worker aktifken
    // tüm tool çağrıları auto-approve olur (parent dahil). v2'de async context'le düzelt.
    const bypassIds = get().bypassWorkerIds
    if (opts?.workerId && bypassIds.has(opts.workerId)) {
      return Promise.resolve("allow")
    }
    if (!opts?.workerId && bypassIds.size > 0) {
      return Promise.resolve("allow")
    }

    // Bypass / kural eşleşmesi → hızlı yol
    const settings = useSettingsStore.getState().settings
    if (settings.approvalMode === "bypass") return Promise.resolve("allow")

    // Otomatik inceleme: salt-okunur tool'lar otomatik onay, diğerleri sorulur
    if (settings.approvalMode === "auto-review" && isReadOnlyTool(tool)) {
      return Promise.resolve("allow")
    }

    const matched = matchRule(settings.approvalRules ?? [], tool, input)
    if (matched === "allow") return Promise.resolve("allow")
    if (matched === "deny") return Promise.resolve("deny")

    // Aksi takdirde kullanıcıya sor
    return new Promise<ApprovalDecision>((resolve) => {
      const id = crypto.randomUUID()
      set((st) => ({
        queue: [...st.queue, { id, tool, input, workerLabel: opts?.workerLabel, resolve }],
      }))
    })
  },

  decide: (id, decision) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return
    req.resolve(decision)
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
  },

  addBypassWorker: (workerId) => {
    set((st) => {
      const next = new Set(st.bypassWorkerIds)
      next.add(workerId)
      return { bypassWorkerIds: next }
    })
  },

  removeBypassWorker: (workerId) => {
    set((st) => {
      const next = new Set(st.bypassWorkerIds)
      next.delete(workerId)
      return { bypassWorkerIds: next }
    })
  },

  clearBypassWorkers: () => {
    set({ bypassWorkerIds: new Set<string>() })
  },
}))

// Basit kural eşleştirici. Tool adı + input pattern (bash command için startsWith,
// dosya işlemleri için path prefix). Settings tarafında tutulan kurallar üzerinden.

function matchRule(
  rules: ApprovalRule[],
  tool: string,
  input: unknown,
): ApprovalDecision | null {
  for (const r of rules) {
    if (r.tool !== "*" && r.tool !== tool) continue
    if (!r.pattern) return r.decision
    const subj = subjectFor(tool, input)
    if (subj && subj.startsWith(r.pattern)) return r.decision
  }
  return null
}

// Auto-review modunda otomatik onaylanan tool'lar.
// bash dışındaki her şey — kullanıcı sonradan diff'i ve dosya değişikliklerini
// görüp geri alabilir. Sadece bash gerçek risk taşıdığı için onay ister.
const AUTO_APPROVED_TOOLS = new Set([
  "read_file",
  "list_dir",
  "search",
  "grep",
  "find",
  "edit_file",
  "write_file",
])
function isReadOnlyTool(tool: string): boolean {
  return AUTO_APPROVED_TOOLS.has(tool)
}

function subjectFor(tool: string, input: unknown): string {
  const i = (input as Record<string, unknown>) ?? {}
  if (tool === "bash") return String(i.command ?? "")
  if (typeof i.path === "string") return i.path
  return ""
}
