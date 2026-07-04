//

import type { WorkflowBudget } from "./budget"

export type ScriptApi = {
  agent: (prompt: string, opts?: unknown) => Promise<unknown>
  log: (msg: string) => void
  phase: (title: string) => void
  workflow: (nameOrRef: unknown, args?: unknown) => Promise<unknown>
  budget: WorkflowBudget
  isAborted: () => boolean
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>

export function makeBlockedDate(): DateConstructor {
  const Blocked = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) {
      throw new Error(
        "argümansız new Date() workflow içinde yasak (determinizm) — timestamp'i args ile geç",
      )
    }
    // @ts-expect-error -- forward to the real Date constructor.
    return new Date(...args)
  } as unknown as DateConstructor
  Blocked.now = () => {
    throw new Error("Date.now() workflow içinde yasak (determinizm)")
  }
  Blocked.parse = Date.parse
  Blocked.UTC = Date.UTC
  return Blocked
}

export const BlockedMath: Math = new Proxy(Math, {
  get(target, prop) {
    if (prop === "random") {
      return () => {
        throw new Error(
          "Math.random() workflow içinde yasak (determinizm) — index/label ile çeşitlendir",
        )
      }
    }
    return Reflect.get(target, prop)
  },
})

export function stripExport(script: string): string {
  return script.replace(/export\s+const\s+meta\s*=/, "const meta =")
}

function makeParallel(api: ScriptApi) {
  return async function parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]> {
    if (api.isAborted()) throw new Error("workflow durduruldu")
    return Promise.all(
      thunks.map((t) =>
        Promise.resolve()
          .then(t)
          .catch(() => null),
      ),
    )
  }
}

function makePipeline(api: ScriptApi) {
  return async function pipeline(
    items: unknown[],
    ...stages: Array<(prev: unknown, item: unknown, idx: number) => unknown | Promise<unknown>>
  ): Promise<unknown[]> {
    if (api.isAborted()) throw new Error("workflow durduruldu")
    return Promise.all(
      items.map(async (item, idx) => {
        let acc: unknown = item
        for (const stage of stages) {
          try {
            acc = await stage(acc, item, idx)
          } catch {
            return null
          }
        }
        return acc
      }),
    )
  }
}

export async function executeScript(
  script: string,
  args: unknown,
  api: ScriptApi,
): Promise<unknown> {
  const body = stripExport(script)
  const fn = new AsyncFunction(
    "agent",
    "parallel",
    "pipeline",
    "log",
    "phase",
    "args",
    "budget",
    "workflow",
    "Date",
    "Math",
    body,
  )
  return fn(
    api.agent,
    makeParallel(api),
    makePipeline(api),
    api.log,
    api.phase,
    args,
    api.budget,
    api.workflow,
    makeBlockedDate(),
    BlockedMath,
  )
}
