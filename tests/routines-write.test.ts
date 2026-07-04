import { describe, it, expect } from "vitest"
import { serializeRoutine, parseRoutineFile } from "@/lib/routines"

describe("serializeRoutine", () => {
  it("frontmatter + body üretir", () => {
    const out = serializeRoutine({
      name: "daily",
      description: "Günlük özet",
      prompt: "Özetle.",
      schedule: "0 9 * * *",
    })
    expect(out).toContain("---\nname: daily")
    expect(out).toContain("description: Günlük özet")
    expect(out).toContain("schedule: 0 9 * * *")
    expect(out.endsWith("Özetle.")).toBe(true)
  })

  it("opsiyonel alanlar boşsa frontmatter'a yazılmaz", () => {
    const out = serializeRoutine({ name: "x", prompt: "do it" })
    expect(out).not.toContain("description:")
    expect(out).not.toContain("schedule:")
    expect(out).not.toContain("provider:")
  })

  it("serialize → parse round-trip alanları korur", () => {
    const input = {
      name: "weekly",
      description: "Haftalık",
      prompt: "Rapor üret.\nİkinci satır.",
      schedule: "0 8 * * 1",
      provider: "openai" as const,
      model: "gpt-5",
    }
    const parsed = parseRoutineFile(serializeRoutine(input), "fallback")
    expect(parsed.name).toBe("weekly")
    expect(parsed.description).toBe("Haftalık")
    expect(parsed.schedule).toBe("0 8 * * 1")
    expect(parsed.provider).toBe("openai")
    expect(parsed.model).toBe("gpt-5")
    expect(parsed.prompt).toBe("Rapor üret.\nİkinci satır.")
  })

  it("once:true round-trip korunur", () => {
    const out = serializeRoutine({
      name: "loop",
      prompt: "Çalış, sonra kendini yeniden zamanla.",
      schedule: "5 12 27 5 *",
      once: true,
    })
    expect(out).toContain("once: true")
    const parsed = parseRoutineFile(out, "fallback")
    expect(parsed.once).toBe(true)
  })

  it("once verilmezse false ve frontmatter'a yazılmaz", () => {
    const out = serializeRoutine({ name: "x", prompt: "do it" })
    expect(out).not.toContain("once:")
    expect(parseRoutineFile(out, "fallback").once).toBe(false)
  })
})
