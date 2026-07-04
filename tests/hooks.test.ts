import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}))

import { Command } from "@tauri-apps/plugin-shell"
import {
  runHooks,
  listPluginHooks,
  _registerPluginHook,
  _unregisterPluginHooks,
  _clearPluginHooks,
} from "@/lib/hooks"
import type { HookConfig } from "@/store/types"

let executeFn: ReturnType<typeof vi.fn>
let _mockStdout = ""
let _mockStderr = ""
let _mockCode = 0

beforeEach(() => {
  executeFn = vi.fn()
  _mockStdout = ""
  _mockStderr = ""
  _mockCode = 0
  vi.mocked(Command.create).mockImplementation(() => {
    const stdoutCbs: ((d: string) => void)[] = []
    const stderrCbs: ((d: string) => void)[] = []
    const closeCbs: ((p: { code: number | null }) => void)[] = []
    const errorCbs: ((e: unknown) => void)[] = []
    return {
      execute: executeFn,
      stdout: { on: (_ev: string, cb: (d: string) => void) => stdoutCbs.push(cb) },
      stderr: { on: (_ev: string, cb: (d: string) => void) => stderrCbs.push(cb) },
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        if (ev === "close") closeCbs.push(cb as (p: { code: number | null }) => void)
        if (ev === "error") errorCbs.push(cb as (e: unknown) => void)
      },
      spawn: vi.fn().mockImplementation(() => {
        Promise.resolve().then(() => {
          if (_mockStdout) stdoutCbs.forEach((c) => c(_mockStdout))
          if (_mockStderr) stderrCbs.forEach((c) => c(_mockStderr))
          closeCbs.forEach((c) => c({ code: _mockCode }))
        })
        return Promise.resolve({ pid: 1234, kill: vi.fn().mockResolvedValue(undefined) })
      }),
    } as unknown as ReturnType<typeof Command.create>
  })
  _clearPluginHooks()
})

function hook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    id: "h1",
    event: "PreToolUse",
    command: "echo ok",
    blocking: false,
    ...overrides,
  }
}

function mockExec(stdout: string, code = 0, stderr = "") {
  _mockStdout = stdout
  _mockStderr = stderr
  _mockCode = code
  executeFn.mockResolvedValue({ stdout, stderr, code })
}

// ─── runHooks — genel ────────────────────────────────────────────────────────

describe("runHooks", () => {
  it("hooks undefined → ranCount:0, blocked:false", async () => {
    const r = await runHooks({
      hooks: undefined,
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r).toEqual({ ranCount: 0, blocked: false })
  })

  it("event eşleşmiyorsa çalıştırılmaz", async () => {
    const r = await runHooks({
      hooks: [hook({ event: "PostToolUse" })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(0)
    expect(executeFn).not.toHaveBeenCalled()
  })

  it("enabled:false → çalıştırılmaz", async () => {
    const r = await runHooks({
      hooks: [hook({ enabled: false })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(0)
  })

  it("matcher '*' → tüm toollar", async () => {
    mockExec("", 0)
    const r = await runHooks({
      hooks: [hook({ matcher: "*" })],
      event: "PreToolUse",
      toolName: "read_file",
      payload: { tool: "read_file", input: {} },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(1)
  })

  it("matcher tam eşleşme → sadece eşleşen tool", async () => {
    mockExec("", 0)
    const r = await runHooks({
      hooks: [hook({ matcher: "bash" })],
      event: "PreToolUse",
      toolName: "read_file",
      payload: { tool: "read_file", input: {} },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(0)
  })

  it("eşleşen hook çalıştırılır", async () => {
    mockExec("", 0)
    const r = await runHooks({
      hooks: [hook({ matcher: "bash" })],
      event: "PreToolUse",
      toolName: "bash",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(1)
  })

  it("PreToolUse + blocking + exit≠0 → blocked", async () => {
    mockExec("", 1, "permission denied")
    const r = await runHooks({
      hooks: [hook({ blocking: true })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(true)
    expect(r.blockReason).toContain("permission denied")
  })

  it("PreToolUse + blocking:false + exit≠0 → blocked değil", async () => {
    mockExec("", 1)
    const r = await runHooks({
      hooks: [hook({ blocking: false })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(false)
  })

  it("PreToolUse + stdout decision:block → blocked", async () => {
    mockExec('{"decision":"block","reason":"rule violated"}', 0)
    const r = await runHooks({
      hooks: [hook({ blocking: true })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(true)
    expect(r.blockReason).toContain("rule violated")
  })

  it("PreToolUse + stdout decision:allow + exit≠0 → allowed (explicit allow wins)", async () => {
    mockExec('{"decision":"allow"}', 1)
    const r = await runHooks({
      hooks: [hook({ blocking: true })],
      event: "PreToolUse",
      payload: { tool: "bash", input: {} },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(false)
  })

  it("PostToolUse → blocking çalışmaz, ranCount döner", async () => {
    mockExec("", 1) // exit 1 ama PostToolUse → block yok
    const r = await runHooks({
      hooks: [hook({ event: "PostToolUse", blocking: true })],
      event: "PostToolUse",
      payload: { tool: "bash", input: {}, output: "out", isError: false },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(false)
    expect(r.ranCount).toBe(1)
  })

  it("UserPromptSubmit + exit:0 → extraContext döner", async () => {
    mockExec("extra context here", 0)
    const r = await runHooks({
      hooks: [hook({ event: "UserPromptSubmit" })],
      event: "UserPromptSubmit",
      payload: { prompt: "hello" },
      workspace: "/ws",
    })
    expect(r.extraContext).toBe("extra context here")
  })

  it("UserPromptSubmit + exit≠0 → extraContext yok", async () => {
    mockExec("some output", 1)
    const r = await runHooks({
      hooks: [hook({ event: "UserPromptSubmit" })],
      event: "UserPromptSubmit",
      payload: { prompt: "hello" },
      workspace: "/ws",
    })
    expect(r.extraContext).toBeUndefined()
  })

  it("Stop → notify-only: ranCount döner, block/extraContext yok", async () => {
    mockExec("ignored output", 0)
    const r = await runHooks({
      hooks: [hook({ event: "Stop" })],
      event: "Stop",
      payload: { reason: "end_turn" },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(1)
    expect(r.blocked).toBe(false)
    expect(r.extraContext).toBeUndefined()
  })

  it("Stop + exit≠0 + blocking → yine blocked değil (notify-only)", async () => {
    mockExec("", 1, "boom")
    const r = await runHooks({
      hooks: [hook({ event: "Stop", blocking: true })],
      event: "Stop",
      payload: { reason: "goal_done" },
      workspace: "/ws",
    })
    expect(r.blocked).toBe(false)
    expect(r.ranCount).toBe(1)
  })

  it("SubagentStop → notify-only: ranCount döner, block yok", async () => {
    mockExec("", 0)
    const r = await runHooks({
      hooks: [hook({ event: "SubagentStop" })],
      event: "SubagentStop",
      payload: { reason: "complete" },
      workspace: "/ws",
    })
    expect(r.ranCount).toBe(1)
    expect(r.blocked).toBe(false)
  })
})


describe("plugin hooks", () => {
  it("başlangıçta boş", () => {
    expect(listPluginHooks()).toEqual([])
  })

  it("_registerPluginHook ekler (id pluginId ile namespace'lenir)", () => {
    _registerPluginHook(hook({ id: "ph1", pluginId: "my-plugin" }))
    expect(listPluginHooks()).toHaveLength(1)
    expect(listPluginHooks()[0].id).toBe("my-plugin:ph1")
  })

  it("farklı plugin'ler aynı raw id'yi kullansa çakışmaz (trust izolasyonu)", () => {
    _registerPluginHook(hook({ id: "fmt", pluginId: "plugin-a" }))
    _registerPluginHook(hook({ id: "fmt", pluginId: "plugin-b" }))
    expect(listPluginHooks()).toHaveLength(2)
    expect(listPluginHooks().map((h) => h.id).sort()).toEqual(["plugin-a:fmt", "plugin-b:fmt"])
  })

  it("aynı id ile register → günceller (upsert)", () => {
    _registerPluginHook(hook({ id: "ph1", command: "old" }))
    _registerPluginHook(hook({ id: "ph1", command: "new" }))
    expect(listPluginHooks()).toHaveLength(1)
    expect(listPluginHooks()[0].command).toBe("new")
  })

  it("_unregisterPluginHooks plugin'e ait hookları kaldırır", () => {
    _registerPluginHook(hook({ id: "h-a", pluginId: "plugin-a" }))
    _registerPluginHook(hook({ id: "h-b", pluginId: "plugin-b" }))
    _unregisterPluginHooks("plugin-a")
    expect(listPluginHooks().map((h) => h.id)).not.toContain("plugin-a:h-a")
    expect(listPluginHooks().map((h) => h.id)).toContain("plugin-b:h-b")
  })

  it("_clearPluginHooks hepsini kaldırır", () => {
    _registerPluginHook(hook({ id: "h1", pluginId: "p" }))
    _registerPluginHook(hook({ id: "h2", pluginId: "p" }))
    _clearPluginHooks()
    expect(listPluginHooks()).toEqual([])
  })
})
