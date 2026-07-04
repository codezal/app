export type WorkflowBudget = {
  readonly total: number | null
  spent: () => number
  remaining: () => number
  add: (outputTokens: number) => void
}

export function createBudget(total: number | null): WorkflowBudget {
  let spent = 0
  return {
    total,
    spent: () => spent,
    remaining: () => (total == null ? Infinity : Math.max(0, total - spent)),
    add: (t) => {
      if (t > 0) spent += t
    },
  }
}
