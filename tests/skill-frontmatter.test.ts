import { describe, it, expect } from "vitest"
import { parseFrontmatter } from "@/lib/skills/frontmatter"
import { parseSkillFile } from "@/lib/skills/parse"

describe("parseFrontmatter", () => {
  it("tek satır + value içinde kolon korunur (tırnaklı)", () => {
    const { data } = parseFrontmatter(`---\nname: t\ndescription: "foo: bar: baz"\n---\nbody`)
    expect(data.name).toBe("t")
    expect(data.description).toBe("foo: bar: baz")
  })

  it("tırnaksız değerde kolon korunur", () => {
    const { data } = parseFrontmatter(`---\ndescription: Use when X: do Y\n---\n`)
    expect(data.description).toBe("Use when X: do Y")
  })

  it("block scalar | literal çok-satır", () => {
    const raw = `---\nname: b\ndescription: |\n  Line 1\n  Line 2\nversion: "1.0"\n---\nrest`
    const { data, body } = parseFrontmatter(raw)
    expect(data.description).toBe("Line 1\nLine 2")
    expect(data.version).toBe("1.0")
    expect(body).toBe("rest")
  })

  it("block scalar > folded boşlukla birleşir", () => {
    const raw = `---\ndescription: >\n  alpha\n  beta\n---\n`
    const { data } = parseFrontmatter(raw)
    expect(data.description).toBe("alpha beta")
  })

  it("inline array", () => {
    const { data } = parseFrontmatter(`---\ntriggers: [a, "b c", d]\n---\n`)
    expect(data.triggers).toEqual(["a", "b c", "d"])
  })

  it("YAML list (- item)", () => {
    const raw = `---\ntriggers:\n  - first\n  - second\n---\n`
    const { data } = parseFrontmatter(raw)
    expect(data.triggers).toEqual(["first", "second"])
  })

  it("bilinmeyen alanlar korunur (version/license)", () => {
    const { data } = parseFrontmatter(`---\nname: x\nlicense: MIT\nversion: 2\n---\n`)
    expect(data.license).toBe("MIT")
    expect(data.version).toBe("2")
  })

  it("frontmatter yoksa body = ham, data boş", () => {
    const { data, body } = parseFrontmatter(`# Sadece markdown\nicerik`)
    expect(data).toEqual({})
    expect(body).toBe("# Sadece markdown\nicerik")
  })
})

describe("parseSkillFile", () => {
  it("isim+açıklama frontmatter'dan, body frontmatter'sız", () => {
    const r = parseSkillFile(`---\nname: demo\ndescription: "A: B"\n---\nGÖVDE`, "fallback")
    expect(r.name).toBe("demo")
    expect(r.description).toBe("A: B")
    expect(r.body).toBe("GÖVDE")
  })

  it("name yoksa fallback kullanılır", () => {
    const r = parseSkillFile(`hiç frontmatter yok`, "klasör-adı")
    expect(r.name).toBe("klasör-adı")
    expect(r.body).toBe("hiç frontmatter yok")
  })

  it("triggers array parse edilir", () => {
    const r = parseSkillFile(`---\nname: t\ntriggers: [x, y]\n---\nb`, "f")
    expect(r.triggers).toEqual(["x", "y"])
  })
})
