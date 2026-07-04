import { describe, it, expect } from "vitest"
import { parseSkillFile, buildSkillsCatalog } from "@/lib/skills/parse"
import type { Skill } from "@/lib/skills/types"

describe("parseSkillFile", () => {
  it("frontmatter yoksa body + fallbackName", () => {
    const r = parseSkillFile("Do the thing.", "my-skill")
    expect(r.name).toBe("my-skill")
    expect(r.body).toBe("Do the thing.")
    expect(r.description).toBe("")
  })

  it("frontmatter name/description parse edilir", () => {
    const raw = `---\nname: formatter\ndescription: Formats code\n---\nFormat all files.`
    const r = parseSkillFile(raw, "fallback")
    expect(r.name).toBe("formatter")
    expect(r.description).toBe("Formats code")
    expect(r.body).toBe("Format all files.")
  })

  it("triggers array parse edilir", () => {
    const raw = `---\nname: x\ntriggers: [review, audit, check]\n---\nbody`
    const r = parseSkillFile(raw, "x")
    expect(r.triggers).toEqual(["review", "audit", "check"])
  })

  it("triggers yoksa undefined", () => {
    const raw = `---\nname: x\n---\nbody`
    const r = parseSkillFile(raw, "x")
    expect(r.triggers).toBeUndefined()
  })

  it("tırnak işaretleri değerden sıyrılır", () => {
    const raw = `---\nname: "quoted-skill"\ndescription: 'single'\n---\nbody`
    const r = parseSkillFile(raw, "f")
    expect(r.name).toBe("quoted-skill")
    expect(r.description).toBe("single")
  })

  it("body 32000 karakterle kısıtlanır", () => {
    const body = "x".repeat(40_000)
    const raw = `---\nname: x\n---\n${body}`
    const r = parseSkillFile(raw, "x")
    expect(r.body.length).toBe(32_000)
  })

  it("frontmatter name yoksa fallbackName", () => {
    const raw = `---\ndescription: d\n---\nbody`
    const r = parseSkillFile(raw, "fallback")
    expect(r.name).toBe("fallback")
  })
})

describe("buildSkillsCatalog", () => {
  it("boş liste → boş string", () => {
    expect(buildSkillsCatalog([])).toBe("")
  })

  it("skill adı + açıklama listede görünür", () => {
    const skills: Skill[] = [
      { name: "formatter", description: "Formats code", scope: "global", path: "/a", dir: "", body: "", bytes: 0 },
    ]
    const out = buildSkillsCatalog(skills)
    expect(out).toContain("formatter")
    expect(out).toContain("Formats code")
  })

  it("trigger'lar listede görünür", () => {
    const skills: Skill[] = [
      {
        name: "reviewer",
        description: "Reviews code",
        triggers: ["review", "audit"],
        scope: "global",
        path: "/a",
        dir: "",
        body: "",
        bytes: 0,
      },
    ]
    const out = buildSkillsCatalog(skills)
    expect(out).toContain("review")
    expect(out).toContain("audit")
  })

  it("plugin skill [plugin:id] etiketi alır", () => {
    const skills: Skill[] = [
      {
        name: "plugin-skill",
        description: "desc",
        scope: "plugin",
        pluginId: "my-plugin",
        path: "/b",
        dir: "",
        body: "",
        bytes: 0,
      },
    ]
    const out = buildSkillsCatalog(skills)
    expect(out).toContain("[plugin:my-plugin]")
  })

  it("çok skill → hepsi listelenir", () => {
    const skills: Skill[] = [
      { name: "a", description: "d1", scope: "global", path: "/1", dir: "", body: "", bytes: 0 },
      { name: "b", description: "d2", scope: "global", path: "/2", dir: "", body: "", bytes: 0 },
    ]
    const out = buildSkillsCatalog(skills)
    expect(out).toContain("a")
    expect(out).toContain("b")
  })

  it("load_skill referansı içerir", () => {
    const skills: Skill[] = [
      { name: "x", description: "d", scope: "global", path: "/x", dir: "", body: "", bytes: 0 },
    ]
    expect(buildSkillsCatalog(skills)).toContain("load_skill")
  })
})
