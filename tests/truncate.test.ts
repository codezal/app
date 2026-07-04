import { describe, it, expect, vi } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}))

import { truncateOutput } from "@/lib/tools/truncate"

describe("truncateOutput", () => {
  it("limit altı → değişmeden döner", async () => {
    const r = await truncateOutput("kısa çıktı\n[exit 0]")
    expect(r.truncated).toBe(false)
    expect(r.content).toContain("[exit 0]")
  })

  it("middle: büyük çıktıda baş + son ([exit N] + stderr) korunur, orta düşer", async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `line${i}`).join("\n")
    const big = `${body}\n[stderr]\nFATAL: boom\n[exit 1]`
    const r = await truncateOutput(big, { direction: "middle" })
    expect(r.truncated).toBe(true)
    expect(r.content).toContain("line0")
    expect(r.content).toContain("[exit 1]")
    expect(r.content).toContain("FATAL: boom")
    expect(r.content).not.toContain("line2500")
  })

  it("head (default): büyük çıktıda baş korunur, son düşer", async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line${i}`).join("\n") + "\n[exit 1]"
    const r = await truncateOutput(big)
    expect(r.truncated).toBe(true)
    expect(r.content).toContain("line0")
    expect(r.content).not.toContain("[exit 1]")
  })
})
