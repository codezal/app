import { describe, it, expect } from "vitest"
import { mergeProjectConfig } from "@/lib/config/merge"
import { DEFAULT_MEMORY } from "@/lib/memory-settings"
import type { Settings } from "@/store/types"
import type { ProjectConfig } from "@/lib/config/schema"

function makeGlobal(instructions: string[]): Settings {
  return { memory: { ...DEFAULT_MEMORY, instructions } } as Settings
}

describe("mergeProjectConfig — memory.instructions sanitizasyonu", () => {
  it("proje yalnız workspace-göreli glob KATABİLİR; URL/abs/~ yok sayılır", () => {
    const global = makeGlobal(["https://trusted.example/x.md"]) // global URL serbest
    const project: ProjectConfig = {
      memory: {
        instructions: [
          "docs/*.md",
          "https://evil.com/x.md", // URL → reddedilir
          "/etc/passwd", // POSIX absolute → reddedilir
          "C:\\secrets.md", // Windows absolute → reddedilir
          "~/secret.md", // home-relative → reddedilir
        ],
      },
    }
    const merged = mergeProjectConfig(global, project)
    expect(merged.memory?.instructions).toEqual(["https://trusted.example/x.md", "docs/*.md"])
  })

  it("proje memory yoksa global instructions korunur", () => {
    const global = makeGlobal(["a.md"])
    const merged = mergeProjectConfig(global, {} as ProjectConfig)
    expect(merged.memory?.instructions).toEqual(["a.md"])
  })

  it("global identity döner (project null)", () => {
    const global = makeGlobal(["a.md"])
    expect(mergeProjectConfig(global, null)).toBe(global)
  })
})
