export type ScrollPos = { top: number; atBottom: boolean }

const positions = new Map<string, ScrollPos>()

export function getScrollPosition(id: string): ScrollPos | undefined {
  return positions.get(id)
}

export function setScrollPosition(id: string, top: number, atBottom: boolean): void {
  positions.set(id, { top, atBottom })
}

export function forgetScrollPosition(id: string): void {
  positions.delete(id)
}
