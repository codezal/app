import { describe, it, expect, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn() }))
vi.mock("@/lib/providers", () => ({ _registerPluginProvider: vi.fn() }))
vi.mock("@/lib/agents/plugin", () => ({ _registerPluginAgent: vi.fn() }))
vi.mock("@/lib/skills/plugin", () => ({ _registerPluginSkill: vi.fn() }))
vi.mock("@/lib/commands/plugin", () => ({ _registerPluginCommand: vi.fn() }))
vi.mock("@/lib/mcp", () => ({ _registerPluginMcp: vi.fn() }))
vi.mock("@/lib/hooks", () => ({ _registerPluginHook: vi.fn() }))
vi.mock("@/lib/plugins/audit", () => ({ appendAudit: vi.fn() }))

import { makePluginAPI, validateEntryPath, withHardenedGlobals } from "@/lib/plugins/sandbox"
import type { InstalledPlugin } from "@/lib/plugins/types"

describe("validateEntryPath", () => {
  it("dizin-içi relative path kabul edilir", () => {
    expect(validateEntryPath("entry.js")).toBeNull()
    expect(validateEntryPath("dist/index.js")).toBeNull()
    expect(validateEntryPath("src/providers/openai.mjs")).toBeNull()
    expect(validateEntryPath("a.b/c.js")).toBeNull()
  })

  it("boş entry reddedilir", () => {
    expect(validateEntryPath("")).toMatch(/boş/)
    // @ts-expect-error -- exercise the runtime guard.
    expect(validateEntryPath(undefined)).toMatch(/boş/)
  })

  it("`..` traversal reddedilir", () => {
    expect(validateEntryPath("../evil.js")).toMatch(/traversal/)
    expect(validateEntryPath("../../../../home/user/.ssh/payload.js")).toMatch(/traversal/)
    expect(validateEntryPath("dist/../../escape.js")).toMatch(/traversal/)
    expect(validateEntryPath("..\\..\\escape.js")).toMatch(/traversal/)
  })

  it("absolute path reddedilir", () => {
    expect(validateEntryPath("/etc/passwd.js")).toMatch(/absolute/)
    expect(validateEntryPath("\\windows\\system32\\x.js")).toMatch(/absolute/)
    expect(validateEntryPath("C:\\Users\\x\\evil.js")).toMatch(/absolute/)
  })

  it("url scheme reddedilir", () => {
    expect(validateEntryPath("file:///etc/evil.js")).toMatch(/url scheme/)
    expect(validateEntryPath("http://evil.com/x.js")).toMatch(/url scheme/)
    expect(validateEntryPath("https://evil.com/x.js")).toMatch(/url scheme/)
  })

  it("içinde `..` substring olan ama segment olmayan isim geçerli", () => {
    expect(validateEntryPath("foo..bar.js")).toBeNull()
    expect(validateEntryPath("dist/..hidden.js")).toBeNull()
  })
})

const makePlugin = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin =>
  ({
    id: "p@community",
    name: "p",
    version: "1",
    channel: "community",
    marketplaceId: "m",
    source: { type: "inline", path: "x" },
    installPath: "/tmp/p",
    enabled: true,
    installedAt: 0,
    manifest: {
      name: "p",
      version: "1",
      permissions: ["network.fetch"],
      network: { allowedHosts: ["api.example.com"] },
      contributes: {},
    },
    ...overrides,
  }) as unknown as InstalledPlugin

describe("makePluginAPI fetch gate (H5)", () => {
  it("allowlist host'u realFetch üzerinden geçirir", async () => {
    const realFetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", realFetch)
    const api = makePluginAPI(makePlugin())
    await api.fetch!("https://api.example.com/v1/models")
    expect(realFetch).toHaveBeenCalledWith("https://api.example.com/v1/models", undefined)
    vi.unstubAllGlobals()
  })

  it("allowlist dışı host'u reddeder ve realFetch'i çağırmaz", async () => {
    const realFetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", realFetch)
    const api = makePluginAPI(makePlugin())
    await expect(api.fetch!("https://evil.com/exfil")).rejects.toThrow(/allowlist/)
    expect(realFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("allowedHosts yoksa her şeyi reddeder (fail-closed)", async () => {
    const realFetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", realFetch)
    const api = makePluginAPI(
      makePlugin({ manifest: { name: "p", version: "1", permissions: ["network.fetch"], contributes: {} } as never }),
    )
    await expect(api.fetch!("https://anything.com")).rejects.toThrow(/allowlist/)
    expect(realFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe("withHardenedGlobals (H5)", () => {
  it("evaluation penceresinde IPC + global fetch'i bloklar, sonra geri yükler", async () => {
    const win = { __TAURI_INTERNALS__: { invoke: vi.fn() } } as unknown as Record<string, unknown>
    ;(globalThis as unknown as { window?: unknown }).window = win
    const realFetch = vi.fn()
    ;(globalThis as unknown as { fetch?: unknown }).fetch = realFetch

    let inside = false
    await withHardenedGlobals(async () => {
      inside = true
      expect(() => (win.__TAURI_INTERNALS__ as { invoke: () => void }).invoke("shell_exec")).toThrow()
      expect(() => (globalThis as unknown as { fetch: (u: string) => void }).fetch("https://evil.com")).toThrow()
    })

    expect(inside).toBe(true)
    expect((win.__TAURI_INTERNALS__ as { invoke: () => void }).invoke).toBeDefined()
    expect(globalThis.fetch).toBe(realFetch)
    delete (globalThis as unknown as { window?: unknown }).window
  })
})
