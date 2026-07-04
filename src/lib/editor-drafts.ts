const drafts = new Map<string, string>()

export function getDraft(path: string): string | undefined {
  return drafts.get(path)
}
export function setDraft(path: string, text: string): void {
  drafts.set(path, text)
}
export function clearDraft(path: string): void {
  drafts.delete(path)
}
