import { describe, it, expect } from "vitest"
import { dedupSkillsByName } from "@/lib/skills/dedup"
import type { Skill } from "@/lib/skills/types"

function mk(name: string, scope: Skill["scope"], origin: Skill["origin"]): Skill {
  return {
    name,
    description: `${scope}/${origin}`,
    path: `/${scope}/${origin}/${name}/SKILL.md`,
    dir: `/${scope}/${origin}/${name}`,
    scope,
    origin,
    body: "",
    bytes: 0,
  }
}

describe("dedupSkillsByName", () => {
  it("aynı isimde ilk gelen kazanır (precedence)", () => {
    const input = [
      mk("review", "project", "codezal"),
      mk("review", "project", "agents"),
      mk("review", "global", "codezal"),
    ]
    const out = dedupSkillsByName(input)
    expect(out).toHaveLength(1)
    expect(out[0].description).toBe("project/codezal")
  })

  it("farklı isimler korunur, sıra bozulmaz", () => {
    const input = [
      mk("a", "project", "codezal"),
      mk("b", "global", "agents"),
      mk("a", "global", "codezal"),
      mk("c", "plugin", "plugin"),
    ]
    const out = dedupSkillsByName(input)
    expect(out.map((s) => s.name)).toEqual(["a", "b", "c"])
  })

  it("boş giriş boş çıkış", () => {
    expect(dedupSkillsByName([])).toEqual([])
  })
})
