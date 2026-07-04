//
//
import { readJson, writeJson } from "@/lib/storage"

const TERMINALS_FILE = "terminals.json"

export type TerminalSnapshot = {
  id: string
  name: string
  buffer: string
  history?: string[]
  savedAt: number
}

export type TerminalsPersist = {
  sessions: TerminalSnapshot[]
  activeId: string | null
}

const EMPTY: TerminalsPersist = { sessions: [], activeId: null }

export async function loadTerminalSnapshots(): Promise<TerminalsPersist> {
  return readJson<TerminalsPersist>(TERMINALS_FILE, EMPTY)
}

export async function saveTerminalSnapshots(data: TerminalsPersist): Promise<void> {
  await writeJson(TERMINALS_FILE, data)
}
