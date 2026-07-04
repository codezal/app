export async function pooledMap<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}
