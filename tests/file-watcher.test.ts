import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  watch: vi.fn(),
  watchImmediate: vi.fn(),
}))

vi.mock("@/lib/git-events", () => ({
  emitGitChanged: vi.fn(),
}))

import { watchImmediate } from "@tauri-apps/plugin-fs"
import { emitGitChanged } from "@/lib/git-events"
import { watchWorkspace, type FileEvent } from "@/lib/file-watcher"

type WatchHandler = (event: { type: unknown; paths: string[] }) => void

let handler: WatchHandler | undefined
let unwatchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  handler = undefined
  unwatchSpy = vi.fn()
  vi.mocked(watchImmediate).mockImplementation(async (_path, h) => {
    handler = h as unknown as WatchHandler
    return unwatchSpy
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const modifyEvent = (paths: string[]) => ({ type: { modify: {} }, paths })

describe("watchWorkspace", () => {
  it("ignores paths under ignored dirs but not FILES named like them", async () => {
    const events: FileEvent[] = []
    await watchWorkspace("/ws", (e) => events.push(e))
    expect(handler).toBeDefined()

    handler!(modifyEvent(["/ws/src/build"])) // a FILE named "build" → passes
    handler!(modifyEvent(["/ws/node_modules/a.js"])) // under node_modules → ignored
    handler!(modifyEvent(["/ws/dist/app.js"])) // under dist dir → ignored
    handler!(modifyEvent(["/ws/lib/out"])) // a FILE named "out" → passes

    expect(events.map((e) => e.path)).toEqual(["/ws/src/build", "/ws/lib/out"])
  })

  it("debounced git-meta events still fire while the watcher is active", () => {
    vi.useFakeTimers()
    return watchWorkspace("/ws", () => {}).then(() => {
      handler!(modifyEvent(["/ws/.git/HEAD"]))
      vi.advanceTimersByTime(300)
      expect(emitGitChanged).toHaveBeenCalledTimes(1)
    })
  })

  it("clears the pending git-meta timer when unwatched", async () => {
    vi.useFakeTimers()
    const unwatch = await watchWorkspace("/ws", () => {})
    handler!(modifyEvent(["/ws/.git/HEAD"]))
    unwatch()
    vi.advanceTimersByTime(300)
    expect(emitGitChanged).not.toHaveBeenCalled()
    expect(unwatchSpy).toHaveBeenCalledTimes(1)
  })
})
