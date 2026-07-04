//
import type { WorkflowJournal } from "./hooks"

export type JournalEntry = { key: string; value: unknown }

const journals = new Map<string, JournalEntry[]>()

export function createJournal(runId: string, resumeFrom?: string): WorkflowJournal {
  const prior = resumeFrom ? (journals.get(resumeFrom) ?? []) : []
  const priorMap = new Map(prior.map((e) => [e.key, e.value]))
  const entries: JournalEntry[] = []
  journals.set(runId, entries)
  return {
    lookup: (key) =>
      priorMap.has(key) ? { hit: true, value: priorMap.get(key) } : { hit: false },
    record: (key, value) => {
      entries.push({ key, value })
    },
  }
}

export function dropJournal(runId: string): void {
  journals.delete(runId)
}
