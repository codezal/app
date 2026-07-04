import { describe, it, expect } from "vitest"
import { buildMemorySystemPrompt } from "@/lib/memory"
import type { MemoryFile } from "@/lib/memory"
import { expandImports, type ImportResolver } from "@/lib/memory-import"

function fakeResolver(
  files: Record<string, string>,
  allow?: (abs: string) => boolean,
): ImportResolver {
  return {
    resolve: (imp, base) => {
      const abs = imp.startsWith("/")
        ? imp
        : base.replace(/\/+$/, "") + "/" + imp.replace(/^\.\//, "")
      if (allow && !allow(abs)) return null
      return abs
    },
    read: async (p) => files[p] ?? null,
    dirOf: (p) => p.slice(0, p.lastIndexOf("/")) || "/",
  }
}

function file(
  name: string,
  content: string,
  scope: "project" | "global" = "project",
): MemoryFile {
  return { path: `/p/${name}`, name, scope, content, bytes: content.length }
}

describe("buildMemorySystemPrompt", () => {
  it("boş liste → boş string", () => {
    expect(buildMemorySystemPrompt([])).toBe("")
  })

  it("başlık ve talimat bloğu içerir", () => {
    const r = buildMemorySystemPrompt([file("CLAUDE.md", "Follow TDD.")])
    expect(r).toContain("Aktif Bellek")
    expect(r).toContain("Follow TDD.")
  })

  it("proje dosyası global'den önce gelir", () => {
    const files = [
      file("global.md", "global content", "global"),
      file("project.md", "project content", "project"),
    ]
    const r = buildMemorySystemPrompt(files)
    expect(r.indexOf("project content")).toBeLessThan(r.indexOf("global content"))
  })

  it("proje dosyası 'Proje:' etiketi alır", () => {
    const r = buildMemorySystemPrompt([file("CLAUDE.md", "content", "project")])
    expect(r).toContain("## Proje: CLAUDE.md")
  })

  it("global dosya 'Global:' etiketi alır", () => {
    const r = buildMemorySystemPrompt([file("notes.md", "content", "global")])
    expect(r).toContain("## Global: notes.md")
  })

  it("birden fazla dosya birleştirilir", () => {
    const files = [
      file("a.md", "aaa", "project"),
      file("b.md", "bbb", "project"),
    ]
    const r = buildMemorySystemPrompt(files)
    expect(r).toContain("aaa")
    expect(r).toContain("bbb")
  })

  it("96KB toplam bütçe aşılınca sonraki dosyalar atlanır", () => {
    const big = "x".repeat(95_970)
    const files = [
      file("aaa-big.md", big, "project"),
      file("zzz-after.md", "should be dropped", "project"),
    ]
    const r = buildMemorySystemPrompt(files)
    expect(r).toContain("x".repeat(100))
    expect(r).not.toContain("should be dropped")
  })

  it("dosya içeriği trim edilir", () => {
    const r = buildMemorySystemPrompt([file("f.md", "  trimmed  \n\n")])
    expect(r).toContain("trimmed")
    expect(r).not.toMatch(/##.*\n\s{2,}/)
  })

  it("bütçe gerçek BYTE ile ölçülür (char değil)", () => {
    const a = "ş".repeat(40)
    const files = [file("a.md", a, "project"), file("z.md", "DROP", "project")]
    const r = buildMemorySystemPrompt(files, { totalBudgetBytes: 100 })
    expect(r).toContain("şş")
    expect(r).not.toContain("DROP")
  })
})

describe("expandImports (@import)", () => {
  it("göreli @import içeriği inline eder", async () => {
    const r = await expandImports("öncesi @./child.md sonrası", "/ws", fakeResolver({
      "/ws/child.md": "ÇOCUK İÇERİK",
    }))
    expect(r).toContain("ÇOCUK İÇERİK")
    expect(r).toContain("<!-- @import ./child.md -->")
  })

  it("döngüsel import sonsuza gitmez (visited)", async () => {
    const files = { "/a.md": "A @./b.md", "/b.md": "B @./a.md" }
    const r = await expandImports(files["/a.md"], "/", fakeResolver(files))
    expect(r).toContain("A")
    expect(r).toContain("B")
    expect((r.match(/<!-- @import \.\/b\.md -->/g) ?? []).length).toBe(1)
  })

  it("kod bloğu (``` fence) içindeki @token yok sayılır", async () => {
    const content = ["```", "@./x.md", "```"].join("\n")
    const r = await expandImports(content, "/ws", fakeResolver({ "/ws/x.md": "INLINED" }))
    expect(r).not.toContain("INLINED")
  })

  it("inline-code (`...`) içindeki @token yok sayılır", async () => {
    const r = await expandImports("bak `@./x.md` koda", "/ws", fakeResolver({ "/ws/x.md": "INLINED" }))
    expect(r).not.toContain("INLINED")
  })

  it("max derinlik aşılınca durur", async () => {
    // 7 seviyelik zincir; MAX_IMPORT_DEPTH=5 → derin seviyeler eklenmez.
    const files: Record<string, string> = {}
    for (let i = 0; i < 7; i++) files[`/f${i}.md`] = `L${i} @./f${i + 1}.md`
    const r = await expandImports(files["/f0.md"], "/", fakeResolver(files))
    expect(r).toContain("L0")
    expect(r).toContain("L4")
    expect(r).not.toContain("L6")
  })

  it("resolve null dönerse (workspace dışı) import atlanır", async () => {
    const r = await expandImports("@/etc/passwd ve @./ok.md", "/ws", fakeResolver(
      { "/ws/ok.md": "OK", "/etc/passwd": "SECRET" },
      (abs) => abs.startsWith("/ws"),
    ))
    expect(r).toContain("OK")
    expect(r).not.toContain("SECRET")
  })
})
