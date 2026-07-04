const positions = new Map<string, number>()

export function getScrollPosition(id: string): number | undefined {
  return positions.get(id)
}

export function setScrollPosition(id: string, top: number): void {
  positions.set(id, top)
}

export function forgetScrollPosition(id: string): void {
  positions.delete(id)
}
