import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => Object.prototype.hasOwnProperty.call(h.files, p)),
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    h.files[p] = c
  }),
  readTextFile: vi.fn(async (p: string) => {
    if (!Object.prototype.hasOwnProperty.call(h.files, p)) throw new Error("ENOENT")
    return h.files[p]
  }),
}))

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/home/test"),
}))

import {
  decideSeedAction,
  reconcileSeedAgents,
  AGENT_TEMPLATES,
} from "@/lib/agents-seed"

const ROOT = "/home/test/.codezal/agents"

beforeEach(() => {
  h.files = {}
})

describe("decideSeedAction", () => {
  const legacy = ["aaa", "bbb"]

  it("dosya yoksa → create", () => {
    expect(decideSeedAction(false, null, "new", legacy)).toBe("create")
  })

  it("içerik yeni gövdeyle eşit → skip (güncel)", () => {
    expect(decideSeedAction(true, "new", "new", legacy)).toBe("skip")
  })

  it("içerik legacyHashes'te → upgrade (değiştirilmemiş eski seed)", () => {
    expect(decideSeedAction(true, "bbb", "new", legacy)).toBe("upgrade")
  })

  it("içerik bilinmeyen (kullanıcı düzenlemiş) → skip (KORU)", () => {
    expect(decideSeedAction(true, "user-edited", "new", legacy)).toBe("skip")
  })

  it("currentHash null + dosya var → skip (defansif)", () => {
    expect(decideSeedAction(true, null, "new", legacy)).toBe("skip")
  })
})

describe("reconcileSeedAgents", () => {
  it("boş FS → tüm agent'lar oluşturulur, içerik gövdeyle birebir", async () => {
    const r = await reconcileSeedAgents()
    expect(r.created.sort()).toEqual(AGENT_TEMPLATES.map((t) => t.name).sort())
    expect(r.upgraded).toEqual([])
    expect(r.preserved).toEqual([])
    for (const tpl of AGENT_TEMPLATES) {
      expect(h.files[`${ROOT}/${tpl.filename}`]).toBe(tpl.body)
    }
  })

  it("güncel gövde diskteyse → korunur (skip), içerik değişmez", async () => {
    const cr = AGENT_TEMPLATES.find((t) => t.name === "code-reviewer")!
    h.files[`${ROOT}/${cr.filename}`] = cr.body
    const r = await reconcileSeedAgents()
    expect(r.preserved).toContain("code-reviewer")
    expect(r.created).not.toContain("code-reviewer")
    expect(h.files[`${ROOT}/${cr.filename}`]).toBe(cr.body)
  })

  it("kullanıcı düzenlemiş dosya → KORUNUR (ezilmez)", async () => {
    const cr = AGENT_TEMPLATES.find((t) => t.name === "code-reviewer")!
    const edited = "---\nname: code-reviewer\n---\nElle düzenlendi"
    h.files[`${ROOT}/${cr.filename}`] = edited
    const r = await reconcileSeedAgents()
    expect(r.preserved).toContain("code-reviewer")
    expect(h.files[`${ROOT}/${cr.filename}`]).toBe(edited)
    expect(r.created).toContain("debugger")
  })

  it("legacy gövde diskte (DI) → upgrade, yeni gövde yazılır", async () => {
    const legacyBody = "---\nname: zzz\n---\nESKI GÖVDE\n"
    const newBody = "---\nname: zzz\n---\nYENI GÖVDE\n"
    const tpl = {
      name: "zzz",
      filename: "zzz.md",
      legacyHashes: [sha(legacyBody)],
      body: newBody,
    }
    h.files[`${ROOT}/zzz.md`] = legacyBody
    const r = await reconcileSeedAgents([tpl])
    expect(r.upgraded).toEqual(["zzz"])
    expect(r.preserved).toEqual([])
    expect(h.files[`${ROOT}/zzz.md`]).toBe(newBody)
  })

  it("CRLF'e drift etmiş legacy → normalize ile yine upgrade olur", async () => {
    const legacyLf = "---\nname: zzz\n---\nESKI\n"
    const tpl = {
      name: "zzz",
      filename: "zzz.md",
      legacyHashes: [sha(legacyLf)],
      body: "---\nname: zzz\n---\nYENI\n",
    }
    h.files[`${ROOT}/zzz.md`] = legacyLf.replace(/\n/g, "\r\n")
    const r = await reconcileSeedAgents([tpl])
    expect(r.upgraded).toEqual(["zzz"])
    expect(h.files[`${ROOT}/zzz.md`]).toBe(tpl.body)
  })
})
