//
//
//
//
const beats = new Map<string, number>()
const active = new Map<string, number>()

export function beginToolActivity(sessionId: string): void {
  active.set(sessionId, (active.get(sessionId) ?? 0) + 1)
  beats.set(sessionId, Date.now())
}

export function endToolActivity(sessionId: string): void {
  const next = (active.get(sessionId) ?? 0) - 1
  if (next <= 0) active.delete(sessionId)
  else active.set(sessionId, next)
}

export function beatTool(sessionId: string): void {
  beats.set(sessionId, Date.now())
}

export function lastToolBeat(sessionId: string): number | undefined {
  return (active.get(sessionId) ?? 0) > 0 ? beats.get(sessionId) : undefined
}

export function clearToolBeat(sessionId: string): void {
  beats.delete(sessionId)
  active.delete(sessionId)
}
