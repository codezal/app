import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

//

const gitOk = spawnSync("git", ["--version"]).status === 0
const bashOk = spawnSync("bash", ["-lc", "true"]).status === 0
const canRun = gitOk && bashOk

const store = vi.hoisted(() => ({ appData: "" }))

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: (program: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => ({
      execute: async () => {
        const r = spawnSync(program, args, {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          encoding: "buffer",
          maxBuffer: 64 * 1024 * 1024,
        })
        return {
          code: r.status ?? (r.error ? 1 : 0),
          stdout: (r.stdout ?? Buffer.alloc(0)).toString("utf8"),
          stderr: (r.stderr ?? Buffer.alloc(0)).toString("utf8"),
          signal: r.signal ?? null,
        }
      },
    }),
  },
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: async (p: string, o?: { recursive?: boolean }) => {
    mkdirSync(p, { recursive: o?.recursive ?? false })
  },
  remove: async (p: string, o?: { recursive?: boolean }) => {
    rmSync(p, { recursive: o?.recursive ?? false, force: true })
  },
  writeTextFile: async (p: string, data: string) => {
    writeFileSync(p, data)
  },
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("") }))

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => store.appData,
}))

// Import after mocks are defined; Vitest hoisting keeps this safe.
import { checkpoint, revertToBase, clearSession } from "@/lib/snapshots"

let appRoot = ""
let workRoot = ""
let counter = 0
const nextSid = () => `test-sess-${counter++}`

beforeAll(() => {
  if (!canRun) return
  appRoot = mkdtempSync(join(tmpdir(), "cz-snap-app-"))
  workRoot = mkdtempSync(join(tmpdir(), "cz-snap-wt-"))
  store.appData = appRoot
})

afterAll(() => {
  for (const d of [appRoot, workRoot]) {
    if (d && existsSync(d)) rmSync(d, { recursive: true, force: true })
  }
})

function makeWorkspace(): string {
  const wt = join(workRoot, `ws-${counter}`)
  mkdirSync(wt, { recursive: true })
  return wt
}

describe.skipIf(!canRun)("snapshots (shadow-git entegrasyon)", () => {
  it("checkpoint + edit + yeni dosya → revert eskiye döndürür ve yeniyi siler", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    writeFileSync(join(wt, "a.txt"), "v1")

    const base = await checkpoint(sid, wt)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, "a.txt"), "v2-degisti")
    writeFileSync(join(wt, "b.txt"), "sonradan eklendi")

    const res = await revertToBase(sid, wt, base!)

    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("v1")
    expect(existsSync(join(wt, "b.txt"))).toBe(false) // sonradan eklenen silindi
    expect(res.restored).toBeGreaterThanOrEqual(1)
    expect(res.deleted).toBeGreaterThanOrEqual(1)
  })

  it("bash benzeri doğrudan fs değişikliği (tool path bildirmeden) yakalanır", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    writeFileSync(join(wt, "config.json"), '{"x":1}')
    const base = await checkpoint(sid, wt)
    expect(base).toBeTruthy()

    rmSync(join(wt, "config.json"))
    writeFileSync(join(wt, "generated.txt"), "bash çıktısı")

    await revertToBase(sid, wt, base!)

    expect(readFileSync(join(wt, "config.json"), "utf8")).toBe('{"x":1}') // silinen geri geldi
    expect(existsSync(join(wt, "generated.txt"))).toBe(false)
  })

  it("binary dosya bozulmadan geri yüklenir", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    const original = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0xfe, 0x00, 0x42])
    writeFileSync(join(wt, "img.bin"), original)

    const base = await checkpoint(sid, wt)
    expect(base).toBeTruthy()

    // Binary'yi boz
    writeFileSync(join(wt, "img.bin"), Buffer.from([0x01, 0x02, 0x03]))

    await revertToBase(sid, wt, base!)

    const restored = readFileSync(join(wt, "img.bin"))
    expect(Buffer.compare(restored, original)).toBe(0) // byte-identical
  })

  it("değişiklik yokken revert no-op (restored/deleted 0)", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    writeFileSync(join(wt, "stable.txt"), "sabit")
    const base = await checkpoint(sid, wt)
    expect(base).toBeTruthy()

    const res = await revertToBase(sid, wt, base!)
    expect(res.restored).toBe(0)
    expect(res.deleted).toBe(0)
    expect(readFileSync(join(wt, "stable.txt"), "utf8")).toBe("sabit")
  })

  it("clearSession gölge gitdir'i siler", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    writeFileSync(join(wt, "f.txt"), "x")
    await checkpoint(sid, wt)

    const gitdir = join(appRoot, "snapshots-git", sid)
    expect(existsSync(gitdir)).toBe(true)

    await clearSession(sid)
    expect(existsSync(gitdir)).toBe(false)
  })

  it("boş base → revert güvenli no-op", async () => {
    const sid = nextSid()
    const wt = makeWorkspace()
    const res = await revertToBase(sid, wt, "")
    expect(res).toEqual({ restored: 0, deleted: 0 })
  })
})
