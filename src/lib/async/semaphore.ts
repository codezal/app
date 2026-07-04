export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    } else {
      this.active++
    }
    try {
      return await fn()
    } finally {
      const next = this.waiters.shift()
      if (next) next()
      else this.active--
    }
  }
}

export function workflowConcurrencyCap(): number {
  const cores =
    (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4
  return Math.max(1, Math.min(16, cores - 2))
}
