import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }))
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ settings: { autoUpdate: true } }) },
}))

import { downloadAndRelaunch } from "@/lib/updater"
import { relaunch } from "@tauri-apps/plugin-process"
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater"

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const emit = (e: object) => e as DownloadEvent

beforeEach(() => {
  vi.mocked(relaunch).mockClear()
})

describe("downloadAndRelaunch single-flight", () => {
  it("joins the in-flight download instead of starting a second one", async () => {
    const gate = deferred<void>()
    const downloadAndInstall = vi.fn(async () => {
      await gate.promise
    })
    const update = { downloadAndInstall } as unknown as Update

    const p1 = downloadAndRelaunch(update, () => {})
    const p2 = downloadAndRelaunch(update, () => {})

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([p1, p2])
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it("resets the guard after a failed download so a retry starts fresh", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down")
    })
    await expect(
      downloadAndRelaunch({ downloadAndInstall: failing } as unknown as Update, () => {}),
    ).rejects.toThrow("network down")

    // Guard must be cleared — the retry triggers a brand-new download.
    const gate = deferred<void>()
    const second = vi.fn(async () => {
      await gate.promise
    })
    const p = downloadAndRelaunch({ downloadAndInstall: second } as unknown as Update, () => {})
    expect(second).toHaveBeenCalledTimes(1)
    gate.resolve()
    await p
  })

  it("reports cumulative progress events", async () => {
    const seen: Array<[number, number]> = []
    const downloadAndInstall = vi.fn(async (cb?: (e: DownloadEvent) => void) => {
      cb?.(emit({ event: "Started", data: { contentLength: 100 } }))
      cb?.(emit({ event: "Progress", data: { chunkLength: 40 } }))
      cb?.(emit({ event: "Progress", data: { chunkLength: 60 } }))
      cb?.(emit({ event: "Finished" }))
    })
    await downloadAndRelaunch({ downloadAndInstall } as unknown as Update, (d, t) => {
      seen.push([d, t])
    })
    expect(seen).toEqual([
      [0, 100],
      [40, 100],
      [100, 100],
      [100, 100],
    ])
  })
})
