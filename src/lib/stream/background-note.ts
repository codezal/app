import type { BackgroundJob } from "@/store/jobs"

// Grounding note injected into the system prompt while background jobs started
// by this session are still running. Without it the model only sees the stale
// "Background job started (id: …)" tool result in the transcript, has no idea
// whether the job finished, and tends to answer a fresh user message ("bitti
// mi?") by resurrecting the previous topic's summary instead of checking the
// job — the "alzheimer" loop.

const MAX_JOBS = 3
const MAX_TAIL_LINES = 8
const MAX_LINE_CHARS = 200
const MAX_NOTE_CHARS = 2000

function elapsedLabel(startedAt: number, now: number): string {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + "…" : line
}

export function buildBackgroundJobsNote(
  jobs: BackgroundJob[],
  opts: { freshUserTurn: boolean; now?: number },
): string {
  const running = jobs.filter((j) => j.status === "running").slice(0, MAX_JOBS)
  if (running.length === 0) return ""
  const now = opts.now ?? Date.now()

  const lines: string[] = [
    "## Active background jobs (still running)",
    "You started these earlier with bash(background:true). Their results are NOT in this conversation yet — the transcript only shows the 'job started' tool result. Never claim a job finished (or failed) without checking it first via bash_status({ id }).",
  ]
  for (const j of running) {
    const cmd = j.command.length > 120 ? j.command.slice(0, 120) + "…" : j.command
    lines.push(`- ${j.id}: \`${cmd}\` — running for ${elapsedLabel(j.startedAt, now)}`)
    if (opts.freshUserTurn && j.output.length > 0) {
      const tail = j.output.slice(-MAX_TAIL_LINES).map(clip)
      lines.push("  recent output:", ...tail.map((l) => `  | ${l}`))
    }
  }
  if (opts.freshUserTurn) {
    lines.push(
      "The user's latest message may be about these jobs or about something new — answer THAT message. Do not repeat or resume an earlier topic's summary.",
    )
  }

  let note = lines.join("\n")
  if (note.length > MAX_NOTE_CHARS) note = note.slice(0, MAX_NOTE_CHARS) + "\n…"
  return note
}
