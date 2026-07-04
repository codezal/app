import { create } from "zustand"

type DirtyState = {
  dirty: Record<string, true>
  setDirty: (path: string, value: boolean) => void
  clearDirty: (path: string) => void
}

export const useDirtyFiles = create<DirtyState>((set) => ({
  dirty: {},
  setDirty: (path, value) =>
    set((s) => {
      const has = s.dirty[path] === true
      if (value === has) return s
      const next = { ...s.dirty }
      if (value) next[path] = true
      else delete next[path]
      return { dirty: next }
    }),
  clearDirty: (path) =>
    set((s) => {
      if (s.dirty[path] === undefined) return s
      const next = { ...s.dirty }
      delete next[path]
      return { dirty: next }
    }),
}))

export function isDirty(path: string): boolean {
  return useDirtyFiles.getState().dirty[path] === true
}
export function setDirty(path: string, value: boolean): void {
  useDirtyFiles.getState().setDirty(path, value)
}
export function clearDirty(path: string): void {
  useDirtyFiles.getState().clearDirty(path)
}
