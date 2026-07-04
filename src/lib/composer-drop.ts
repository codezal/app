//
//
import { getCurrentWebview } from "@tauri-apps/api/webview"

type DropHandler = (paths: string[]) => void
type InsertHandler = (text: string) => void

const handlers = new Map<string, DropHandler>()
const insertHandlers = new Map<string, InsertHandler>()
let focusedKey: string | null = null
let unlisten: (() => void) | null = null
let starting = false

export function setFocusedComposer(key: string | null) {
  focusedKey = key
}

export function registerComposerInsert(key: string, handler: InsertHandler): () => void {
  insertHandlers.set(key, handler)
  return () => {
    insertHandlers.delete(key)
  }
}

export function insertToFocusedComposer(text: string): boolean {
  const key =
    (focusedKey && insertHandlers.has(focusedKey) ? focusedKey : null) ??
    (insertHandlers.has("__global__") ? "__global__" : null) ??
    insertHandlers.keys().next().value
  if (key) {
    insertHandlers.get(key)?.(text)
    return true
  }
  return false
}

export function registerComposerDrop(key: string, handler: DropHandler): () => void {
  handlers.set(key, handler)
  void ensureListener()
  return () => {
    handlers.delete(key)
    if (focusedKey === key) focusedKey = null
  }
}

function dispatch(paths: string[]) {
  if (paths.length === 0) return
  const key =
    (focusedKey && handlers.has(focusedKey) ? focusedKey : null) ??
    (handlers.has("__global__") ? "__global__" : null) ??
    handlers.keys().next().value
  if (key) handlers.get(key)?.(paths)
}

async function ensureListener() {
  if (unlisten || starting) return
  starting = true
  try {
    unlisten = await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") dispatch(e.payload.paths)
    })
  } catch (err) {
    console.warn("[composer-drop] Tauri drag-drop listener kurulamadı", err)
  } finally {
    starting = false
  }
}
