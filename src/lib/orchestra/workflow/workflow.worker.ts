//
import { executeScript, type ScriptApi } from "./script-runner"
import { neutralizeGlobals, type WorkerToHost, type HostToWorker } from "./sandbox-protocol"
import type { WorkflowBudget } from "./budget"

const ctx = self as unknown as {
  postMessage: (m: unknown) => void
  addEventListener: (type: "message", listener: (e: { data: unknown }) => void) => void
}
const post = (m: WorkerToHost): void => ctx.postMessage(m)

let nextId = 1
const agentPending = new Map<number, (m: Extract<HostToWorker, { t: "agentRes" }>) => void>()
const wfPending = new Map<number, (m: Extract<HostToWorker, { t: "wfRes" }>) => void>()

let budgetTotal: number | null = null
let budgetSpent = 0
const budget: WorkflowBudget = {
  get total() {
    return budgetTotal
  },
  spent: () => budgetSpent,
  remaining: () => (budgetTotal == null ? Infinity : Math.max(0, budgetTotal - budgetSpent)),
  add: () => {},
}

let nesting = 0

const api: ScriptApi = {
  agent: (prompt, opts) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      agentPending.set(id, (m) => {
        if (m.ok) resolve(m.value)
        else reject(new Error(m.error))
      })
      post({ t: "agent", id, prompt: String(prompt), opts })
    }),
  log: (msg) => post({ t: "log", msg: String(msg) }),
  phase: (title) => post({ t: "phase", title: String(title) }),
  workflow: async (ref, args) => {
    if (nesting >= 1) {
      throw new Error("workflow() iç içe çağrı tek seviye — bir alt-workflow içinde workflow() çağrılamaz")
    }
    const id = nextId++
    const resolved = await new Promise<Extract<HostToWorker, { t: "wfRes" }>>((res) => {
      wfPending.set(id, res)
      post({ t: "wf", id, ref })
    })
    if (resolved.ok) {
      nesting++
      try {
        return await executeScript(resolved.script ?? "", args, api)
      } finally {
        nesting--
      }
    }
    throw new Error(resolved.error || "workflow çözülemedi")
  },
  budget,
  isAborted: () => false,
}

ctx.addEventListener("message", (e) => {
  const m = e.data as HostToWorker
  if (m.t === "start") {
    budgetTotal = m.budgetTotal
    neutralizeGlobals(self as unknown as Record<string, unknown>)
    executeScript(m.script, m.args, api).then(
      (result) => post({ t: "done", result }),
      (err: unknown) => post({ t: "fail", error: err instanceof Error ? err.message : String(err) }),
    )
  } else if (m.t === "agentRes") {
    budgetSpent = m.spent
    const fn = agentPending.get(m.id)
    agentPending.delete(m.id)
    fn?.(m)
  } else if (m.t === "wfRes") {
    const fn = wfPending.get(m.id)
    wfPending.delete(m.id)
    fn?.(m)
  }
})
