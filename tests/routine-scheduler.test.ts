import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/routines", () => ({
  readWorkspaceRoutines: vi.fn().mockResolvedValue([]),
  readUserRoutines: vi.fn().mockResolvedValue([]),
  deleteRoutine: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/cron", () => ({
  parseCron: vi.fn().mockReturnValue({}),
  matches: vi.fn().mockReturnValue(false),
  prevFireAt: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/autopilot-state", () => ({
  loadFired: vi.fn().mockResolvedValue({}),
  saveFired: vi.fn().mockResolvedValue(undefined),
}))

import { readWorkspaceRoutines, readUserRoutines, deleteRoutine } from "@/lib/routines"
import { matches } from "@/lib/cron"
import {
  startScheduler,
  stopScheduler,
  refreshScheduler,
  listScheduled,
} from "@/lib/routine-scheduler"
import type { Routine } from "@/lib/routines"

const mockRWR = vi.mocked(readWorkspaceRoutines)
const mockRUR = vi.mocked(readUserRoutines)
const mockMatches = vi.mocked(matches)
const mockDelete = vi.mocked(deleteRoutine)

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.setSystemTime(new Date("2024-01-01T09:00:00.000Z"))
  mockRWR.mockResolvedValue([])
  mockRUR.mockResolvedValue([])
  mockMatches.mockReturnValue(false)
  mockDelete.mockResolvedValue(undefined)
  stopScheduler()
})

afterEach(() => {
  stopScheduler()
  vi.useRealTimers()
})

function makeRoutine(name: string, schedule: string): Routine {
  return {
    name,
    description: `desc ${name}`,
    schedule,
    path: `/routines/${name}.md`,
    scope: "project",
    prompt: `Run ${name}`,
  }
}

describe("listScheduled", () => {
  it("başlangıçta boş", () => {
    expect(listScheduled()).toEqual([])
  })

  it("startScheduler sonrası schedule'lı rutinler listelenir", async () => {
    const r = makeRoutine("daily", "0 9 * * *")
    mockRWR.mockResolvedValue([r])
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    const listed = listScheduled()
    expect(listed).toHaveLength(1)
    expect(listed[0].routine.name).toBe("daily")
    expect(listed[0].schedule).toBe("0 9 * * *")
  })

  it("schedule alanı olmayan rutinler listelenmez", async () => {
    const r: Routine = {
      name: "no-sched",
      description: "",
      path: "/r.md",
      scope: "project",
      prompt: "x",
    }
    mockRWR.mockResolvedValue([r])
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    expect(listScheduled()).toEqual([])
  })

  it("stopScheduler sonrası boş", async () => {
    mockRWR.mockResolvedValue([makeRoutine("daily", "0 9 * * *")])
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    expect(listScheduled().length).toBeGreaterThan(0)
    stopScheduler()
    expect(listScheduled()).toEqual([])
  })
})

describe("startScheduler / stopScheduler", () => {
  it("stopScheduler timer'ı temizler", async () => {
    const clearSpy = vi.spyOn(global, "clearInterval")
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    stopScheduler()
    expect(clearSpy).toHaveBeenCalled()
  })

  it("ardışık startScheduler önceki timer'ı iptal eder", async () => {
    const clearSpy = vi.spyOn(global, "clearInterval")
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    expect(clearSpy).toHaveBeenCalled()
  })
})

describe("refreshScheduler", () => {
  it("yeni rutinleri yükler", async () => {
    await startScheduler({ workspacePath: "/ws", onFire: vi.fn() })
    expect(listScheduled()).toHaveLength(0)

    vi.setSystemTime(new Date("2024-01-01T09:01:00.000Z")) // yeni dakika
    mockRWR.mockResolvedValue([makeRoutine("new-task", "* * * * *")])
    await refreshScheduler("/ws")
    expect(listScheduled()).toHaveLength(1)
  })
})

describe("tick — fire callback", () => {
  it("matches true ise onFire çağrılır", async () => {
    const onFire = vi.fn()
    const r = makeRoutine("trigger", "* * * * *")
    mockRWR.mockResolvedValue([r])
    mockMatches.mockReturnValue(true)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).toHaveBeenCalledWith(r)
  })

  it("matches false ise onFire çağrılmaz", async () => {
    const onFire = vi.fn()
    mockRWR.mockResolvedValue([makeRoutine("no-match", "0 3 * * 0")])
    mockMatches.mockReturnValue(false)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).not.toHaveBeenCalled()
  })

  it("once rutin fire sonrası deleteRoutine ile silinir", async () => {
    const onFire = vi.fn()
    const r: Routine = {
      name: "loop",
      description: "",
      schedule: "* * * * *",
      once: true,
      path: "/r/loop.md",
      scope: "project",
      prompt: "x",
    }
    mockRWR.mockResolvedValue([r])
    mockMatches.mockReturnValue(true)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).toHaveBeenCalledWith(r)
    await flush()
    expect(mockDelete).toHaveBeenCalledWith("/r/loop.md")
  })

  it("once olmayan rutin fire sonrası silinmez", async () => {
    const onFire = vi.fn()
    mockRWR.mockResolvedValue([makeRoutine("recurring", "* * * * *")])
    mockMatches.mockReturnValue(true)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).toHaveBeenCalled()
    await flush()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("aynı dakikada iki kez fire olmaz", async () => {
    const onFire = vi.fn()
    const r = makeRoutine("once", "* * * * *")
    mockRWR.mockResolvedValue([r])
    mockMatches.mockReturnValue(true)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("farklı dakikada tekrar fire olur", async () => {
    const onFire = vi.fn()
    const r = makeRoutine("repeat", "* * * * *")
    mockRWR.mockResolvedValue([r])
    mockMatches.mockReturnValue(true)

    await startScheduler({ workspacePath: "/ws", onFire })
    expect(onFire).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2024-01-01T09:01:00.000Z"))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onFire).toHaveBeenCalledTimes(2)
  })
})
