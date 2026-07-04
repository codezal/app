import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: vi.fn() } }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

import { useJobsStore, type BackgroundJob } from "@/store/jobs"

function mkJob(
  id: string,
  ownerSessionId: string | undefined,
  status: BackgroundJob["status"],
): BackgroundJob {
  return {
    id,
    command: "sleep 999",
    status,
    output: [],
    emitted: 0,
    exitCode: null,
    startedAt: 0,
    ownerSessionId,
  }
}

beforeEach(() => {
  useJobsStore.setState({ jobs: {} })
})

describe("killBySession", () => {
  it("yalnız eşleşen owner'ın ÇALIŞAN işlerini iptal eder", async () => {
    useJobsStore.setState({
      jobs: {
        a1: mkJob("a1", "A", "running"),
        a2: mkJob("a2", "A", "running"),
        b1: mkJob("b1", "B", "running"),
        adone: mkJob("adone", "A", "done"),
      },
    })
    await useJobsStore.getState().killBySession("A")
    const jobs = useJobsStore.getState().jobs
    expect(jobs.a1.status).toBe("cancelled")
    expect(jobs.a2.status).toBe("cancelled")
    expect(jobs.b1.status).toBe("running")
    expect(jobs.adone.status).toBe("done") // zaten terminal — dokunulmaz
  })

  it("owner'sız (etiketlenmemiş) işlere dokunmaz", async () => {
    useJobsStore.setState({ jobs: { x: mkJob("x", undefined, "running") } })
    await useJobsStore.getState().killBySession("A")
    expect(useJobsStore.getState().jobs.x.status).toBe("running")
  })

  it("boş sessionId → no-op", async () => {
    useJobsStore.setState({ jobs: { x: mkJob("x", "A", "running") } })
    await useJobsStore.getState().killBySession("")
    expect(useJobsStore.getState().jobs.x.status).toBe("running")
  })

  it("eşleşen çalışan iş yoksa sessizce geçer", async () => {
    useJobsStore.setState({ jobs: { adone: mkJob("adone", "A", "done") } })
    await expect(useJobsStore.getState().killBySession("A")).resolves.toBeUndefined()
    expect(useJobsStore.getState().jobs.adone.status).toBe("done")
  })
})
