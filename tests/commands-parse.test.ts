import { describe, it, expect } from "vitest"
import {
  parseCommandFile,
  templateHasArgs,
  parseSlashInput,
  renderTemplate,
} from "@/lib/commands/parse"

describe("parseCommandFile", () => {
  it("frontmatter yoksa body template, fallbackName alınır", () => {
    const r = parseCommandFile("hello world", "my-cmd")
    expect(r.name).toBe("my-cmd")
    expect(r.template).toBe("hello world")
    expect(r.description).toBe("")
  })

  it("frontmatter varsa name/description parse edilir", () => {
    const raw = `---\nname: greet\ndescription: Greets the user\n---\nHello!`
    const r = parseCommandFile(raw, "fallback")
    expect(r.name).toBe("greet")
    expect(r.description).toBe("Greets the user")
    expect(r.template).toBe("Hello!")
  })

  it("tırnak işaretleri değerden sıyrılır", () => {
    const raw = `---\nname: "quoted"\ndescription: 'single'\n---\nbody`
    const r = parseCommandFile(raw, "f")
    expect(r.name).toBe("quoted")
    expect(r.description).toBe("single")
  })

  it("agent/model/subtask frontmatter alanları okunur", () => {
    const raw = `---\nname: x\nagent: my-agent\nmodel: claude-opus-4-7\nsubtask: true\n---\nbody`
    const r = parseCommandFile(raw, "x")
    expect(r.agent).toBe("my-agent")
    expect(r.model).toBe("claude-opus-4-7")
    expect(r.subtask).toBe(true)
  })

  it("subtask: false → subtask alanı yok", () => {
    const raw = `---\nname: x\nsubtask: false\n---\nbody`
    const r = parseCommandFile(raw, "x")
    expect(r.subtask).toBeUndefined()
  })

  it("disallowed-tools virgülle ayrılmış string[] olur", () => {
    const raw = `---\nname: x\ndisallowed-tools: read_file, bash, write_file\n---\nbody`
    const r = parseCommandFile(raw, "x")
    expect(r.disallowedTools).toEqual(["read_file", "bash", "write_file"])
  })

  it("disallowedTools camelCase de okunur", () => {
    const raw = `---\nname: x\ndisallowedTools: bash\n---\nbody`
    const r = parseCommandFile(raw, "x")
    expect(r.disallowedTools).toEqual(["bash"])
  })

  it("disallowed-tools boş entry'leri atar", () => {
    const raw = `---\nname: x\ndisallowed-tools: a, , b,\n---\nbody`
    const r = parseCommandFile(raw, "x")
    expect(r.disallowedTools).toEqual(["a", "b"])
  })

  it("disallowed-tools yoksa/boşsa alan undefined", () => {
    expect(parseCommandFile(`---\nname: x\n---\nbody`, "x").disallowedTools).toBeUndefined()
    expect(parseCommandFile(`---\nname: x\ndisallowed-tools:   \n---\nbody`, "x").disallowedTools).toBeUndefined()
  })

  it("frontmatter name yoksa fallbackName kullanılır", () => {
    const raw = `---\ndescription: d\n---\nbody`
    const r = parseCommandFile(raw, "fallback")
    expect(r.name).toBe("fallback")
  })

  it("body 8000 karakterle kısıtlanır", () => {
    const body = "x".repeat(10_000)
    const r = parseCommandFile(body, "x")
    expect(r.template.length).toBe(8_000)
  })
})

describe("templateHasArgs", () => {
  it("undefined → false", () => {
    expect(templateHasArgs(undefined)).toBe(false)
  })

  it("boş string → false", () => {
    expect(templateHasArgs("")).toBe(false)
  })

  it("$ARGUMENTS → true", () => {
    expect(templateHasArgs("Do something with $ARGUMENTS")).toBe(true)
  })

  it("$ARGS → true", () => {
    expect(templateHasArgs("echo $ARGS")).toBe(true)
  })

  it("$ARG → true", () => {
    expect(templateHasArgs("use $ARG here")).toBe(true)
  })

  it("$1 → true", () => {
    expect(templateHasArgs("first: $1")).toBe(true)
  })

  it("$9 → true", () => {
    expect(templateHasArgs("ninth: $9")).toBe(true)
  })

  it("{{args}} → true", () => {
    expect(templateHasArgs("run with {{args}}")).toBe(true)
  })

  it("{{arg}} → true", () => {
    expect(templateHasArgs("use {{arg}}")).toBe(true)
  })

  it("token içermeyen → false", () => {
    expect(templateHasArgs("just a static command")).toBe(false)
  })

  it("sadece escape'li \\$5 → false (placeholder değil)", () => {
    expect(templateHasArgs("only \\$5 literal")).toBe(false)
  })

  it("escape + gerçek $1 birlikte → true", () => {
    expect(templateHasArgs("$1 and \\$2")).toBe(true)
  })

  it("çift backslash + $1 → true (even run, aktif placeholder)", () => {
    expect(templateHasArgs("a \\\\$1 b")).toBe(true)
  })
})

describe("parseSlashInput", () => {
  it("/ ile başlamıyorsa null", () => {
    expect(parseSlashInput("hello")).toBeNull()
  })

  it("sadece komut adı, arg yok", () => {
    expect(parseSlashInput("/help")).toEqual({ name: "help", args: "" })
  })

  it("komut + argümanlar", () => {
    expect(parseSlashInput("/run foo bar")).toEqual({ name: "run", args: "foo bar" })
  })

  it("argümanlar trim edilir", () => {
    const r = parseSlashInput("/cmd   hello world")
    expect(r?.args).toBe("hello world")
  })

  it("boş string → null", () => {
    expect(parseSlashInput("")).toBeNull()
  })
})

describe("renderTemplate", () => {
  it("token yok → olduğu gibi", () => {
    expect(renderTemplate("static text", "ignored")).toBe("static text")
  })

  it("$ARGUMENTS tam arg string ile değişir", () => {
    expect(renderTemplate("do $ARGUMENTS now", "foo bar")).toBe("do foo bar now")
  })

  it("$ARGS tam arg string ile değişir", () => {
    expect(renderTemplate("x $ARGS y", "a b")).toBe("x a b y")
  })

  it("$ARG tam arg string ile değişir", () => {
    expect(renderTemplate("$ARG", "hello")).toBe("hello")
  })

  it("{{args}} tam arg string ile değişir", () => {
    expect(renderTemplate("run {{args}}", "one two")).toBe("run one two")
  })

  it("{{arg}} tam arg string ile değişir", () => {
    expect(renderTemplate("do {{arg}}", "x")).toBe("do x")
  })

  it("$1 ilk token ile değişir", () => {
    expect(renderTemplate("first: $1", "alpha beta")).toBe("first: alpha")
  })

  it("$2 ikinci token ile değişir", () => {
    expect(renderTemplate("$1 and $2", "a b")).toBe("a and b")
  })

  it("mevcut olmayan pozisyon boş string olur", () => {
    expect(renderTemplate("$3", "a b")).toBe("")
  })

  it("arg boş → $1 boş", () => {
    expect(renderTemplate("$1", "")).toBe("")
  })

  it("$ARG önce, $ARGUMENTS sonra genişlerse örtüşme yok", () => {
    const r = renderTemplate("$ARGUMENTS", "test")
    expect(r).toBe("test")
  })

  it("\\$5 literal $5 olur (escape, substitution yok)", () => {
    expect(renderTemplate("price is \\$5", "a b c d e f")).toBe("price is $5")
  })

  it("\\$1 arg olsa bile değişmez, literal $1 kalır", () => {
    expect(renderTemplate("\\$1", "alpha")).toBe("$1")
  })

  it("escape ve gerçek pozisyon karışık çalışır", () => {
    expect(renderTemplate("$1 then \\$2", "a b")).toBe("a then $2")
  })

  it("çift backslash → bir literal backslash + arg (even run aktif)", () => {
    expect(renderTemplate("\\\\$1", "X")).toBe("\\X")
  })

  it("üç backslash → bir literal backslash + escape'li $1", () => {
    expect(renderTemplate("\\\\\\$1", "X")).toBe("\\$1")
  })
})
