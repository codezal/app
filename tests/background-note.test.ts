import { describe, expect, it } from "vitest"
import { buildBackgroundJobsNote } from "@/lib/stream/background-note"
import type { BackgroundJob } from "@/store/jobs"

function job(partial: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: "job_1",
    command: "npm run tauri build",
    status: "running",
    output: [],
    emitted: 0,
    exitCode: null,
    startedAt: 1_000_000,
    ownerSessionId: "s1",
    ...partial,
  }
}

const NOW = 1_000_000 + (4 * 60 + 12) * 1000 // startedAt + 4m 12s

describe("buildBackgroundJobsNote", () => {
  it("returns empty when nothing is running", () => {
    expect(buildBackgroundJobsNote([], { freshUserTurn: true })).toBe("")
    expect(
      buildBackgroundJobsNote([job({ status: "done" }), job({ status: "error", id: "j2" })], {
        freshUserTurn: true,
      }),
    ).toBe("")
  })

  it("lists running jobs with elapsed time and the no-result-yet warning", () => {
    const note = buildBackgroundJobsNote([job({})], { freshUserTurn: false, now: NOW })
    expect(note).toContain("job_1")
    expect(note).toContain("npm run tauri build")
    expect(note).toContain("running for 4m 12s")
    expect(note).toContain("results are NOT in this conversation yet")
    expect(note).toContain("bash_status")
  })

  it("includes the output tail and steer line only on a fresh user turn", () => {
    const j = job({ output: ["line a", "line b"] })
    const fresh = buildBackgroundJobsNote([j], { freshUserTurn: true, now: NOW })
    expect(fresh).toContain("recent output:")
    expect(fresh).toContain("| line a")
    expect(fresh).toContain("| line b")
    expect(fresh).toContain("answer THAT message")

    const cont = buildBackgroundJobsNote([j], { freshUserTurn: false, now: NOW })
    expect(cont).not.toContain("recent output:")
    expect(cont).not.toContain("| line a")
    expect(cont).not.toContain("answer THAT message")
    // …but the grounding warning is always present
    expect(cont).toContain("results are NOT in this conversation yet")
  })

  it("caps the number of listed jobs", () => {
    const jobs = ["a", "b", "c", "d", "e"].map((id, i) =>
      job({ id, command: `cmd-${id}`, startedAt: 1_000_000 + i }),
    )
    const note = buildBackgroundJobsNote(jobs, { freshUserTurn: false, now: NOW })
    expect(note).toContain("cmd-a")
    expect(note).toContain("cmd-c")
    expect(note).not.toContain("cmd-d")
    expect(note).not.toContain("cmd-e")
  })

  it("keeps only the last lines of a long output tail and clips long lines", () => {
    const output = Array.from({ length: 30 }, (_, i) => `out-${i}`)
    output[29] = "x".repeat(500)
    const note = buildBackgroundJobsNote([job({ output })], { freshUserTurn: true, now: NOW })
    expect(note).not.toContain("out-0")
    expect(note).toContain("out-22")
    expect(note).toContain("x".repeat(200) + "…")
    expect(note).not.toContain("x".repeat(201))
  })

  it("enforces the overall note size cap", () => {
    const j = job({ output: Array.from({ length: 8 }, () => "y".repeat(200)) })
    const note = buildBackgroundJobsNote([j, job({ id: "j2" })], {
      freshUserTurn: true,
      now: NOW,
    })
    expect(note.length).toBeLessThanOrEqual(2100)
  })
})
