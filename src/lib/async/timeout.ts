export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(label ? `${label} timed out after ${ms}ms` : `Operation timed out after ${ms}ms`)),
        ms,
      )
    }),
  ])
}
