import { describe, it, expect } from "vitest"
import { parseAgentFile, checkSubagentPolicy, buildAgentsCatalog } from "@/lib/agents/parse"
import type { AgentDef } from "@/lib/agents/types"

describe("parseAgentFile", () => {
  it("frontmatter yoksa body systemPrompt, fallbackName alınır", () => {
    const r = parseAgentFile("You are a helpful assistant.", "my-agent")
    expect(r.name).toBe("my-agent")
    expect(r.systemPrompt).toBe("You are a helpful assistant.")
    expect(r.description).toBe("")
  })

  it("frontmatter varsa name/description parse edilir", () => {
    const raw = `---\nname: reviewer\ndescription: Code reviewer\n---\nReview code.`
    const r = parseAgentFile(raw, "fallback")
    expect(r.name).toBe("reviewer")
    expect(r.description).toBe("Code reviewer")
    expect(r.systemPrompt).toBe("Review code.")
  })

  it("provider ve model parse edilir", () => {
    const raw = `---\nname: x\nprovider: anthropic\nmodel: claude-haiku-4-5\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.provider).toBe("anthropic")
    expect(r.model).toBe("claude-haiku-4-5")
  })

  it("tools array parse edilir", () => {
    const raw = `---\nname: x\ntools: [bash, read_file, write_file]\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.tools).toEqual(["bash", "read_file", "write_file"])
  })

  it("max_steps sayı parse edilir", () => {
    const raw = `---\nname: x\nmax_steps: 20\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.maxSteps).toBe(20)
  })

  it("plan_mode: true → policy.planMode: true", () => {
    const raw = `---\nname: x\nplan_mode: true\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.policy.planMode).toBe(true)
  })

  it("deny_tools array policy'ye gider", () => {
    const raw = `---\nname: x\ndeny_tools: [bash, delete_file]\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.policy.denyTools).toEqual(["bash", "delete_file"])
  })

  it("bash_allow / bash_deny parse edilir", () => {
    const raw = `---\nname: x\nbash_allow: [git, npm]\nbash_deny: [rm, sudo]\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.policy.bashAllow).toEqual(["git", "npm"])
    expect(r.policy.bashDeny).toEqual(["rm", "sudo"])
  })

  it("approval_required parse edilir", () => {
    const raw = `---\nname: x\napproval_required: [write_file]\n---\nbody`
    const r = parseAgentFile(raw, "x")
    expect(r.policy.approvalRequired).toEqual(["write_file"])
  })

  it("body 32000 karakterle kısıtlanır", () => {
    const body = "x".repeat(40_000)
    const raw = `---\nname: x\n---\n${body}`
    const r = parseAgentFile(raw, "x")
    expect(r.systemPrompt.length).toBe(32_000)
  })

  it("tırnak işaretleri değerden sıyrılır", () => {
    const raw = `---\nname: "my-agent"\ndescription: 'desc'\n---\nbody`
    const r = parseAgentFile(raw, "f")
    expect(r.name).toBe("my-agent")
    expect(r.description).toBe("desc")
  })
})

describe("checkSubagentPolicy", () => {
  const emptyPolicy = {}

  it("boş policy → tüm araçlara izin verir", () => {
    const r = checkSubagentPolicy(emptyPolicy, "bash", { command: "ls" })
    expect(r.allowed).toBe(true)
    expect(r.requiresApproval).toBe(false)
  })

  it("denyTools listesindeki araç → reddedilir", () => {
    const r = checkSubagentPolicy({ denyTools: ["bash"] }, "bash", {})
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/bash/)
  })

  it("whitelist varsa dışındaki araç → reddedilir", () => {
    const r = checkSubagentPolicy({ tools: ["read_file"] }, "bash", {})
    expect(r.allowed).toBe(false)
  })

  it("whitelist varsa içindeki araç → izin verilir", () => {
    const r = checkSubagentPolicy({ tools: ["bash", "read_file"] }, "bash", {})
    expect(r.allowed).toBe(true)
  })

  it("planMode → write_file reddedilir", () => {
    const r = checkSubagentPolicy({ planMode: true }, "write_file", {})
    expect(r.allowed).toBe(false)
  })

  it("planMode → edit_file reddedilir", () => {
    const r = checkSubagentPolicy({ planMode: true }, "edit_file", {})
    expect(r.allowed).toBe(false)
  })

  it("planMode → bash reddedilir (bashAllow yok)", () => {
    const r = checkSubagentPolicy({ planMode: true }, "bash", {})
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/bash_allow/)
  })

  it("planMode + boş bashAllow → bash yine reddedilir", () => {
    const r = checkSubagentPolicy({ planMode: true, bashAllow: [] }, "bash", { command: "git diff" })
    expect(r.allowed).toBe(false)
  })

  it("planMode + bashAllow → izinli komut çalışır", () => {
    const r = checkSubagentPolicy(
      { planMode: true, bashAllow: ["git diff", "git log"] },
      "bash",
      { command: "git diff --cached" },
    )
    expect(r.allowed).toBe(true)
  })

  it("planMode + bashAllow → izinli olmayan komut reddedilir", () => {
    const r = checkSubagentPolicy(
      { planMode: true, bashAllow: ["git diff"] },
      "bash",
      { command: "rm -rf /tmp" },
    )
    expect(r.allowed).toBe(false)
  })

  it("planMode + bashAllow → metacharacter bypass reddedilir", () => {
    const r = checkSubagentPolicy(
      { planMode: true, bashAllow: ["git diff"] },
      "bash",
      { command: "git diff; rm -rf /" },
    )
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/metacharacters/)
  })

  it("planMode + bashAllow → write_file hâlâ reddedilir", () => {
    const r = checkSubagentPolicy(
      { planMode: true, bashAllow: ["git diff"] },
      "write_file",
      {},
    )
    expect(r.allowed).toBe(false)
  })

  it("planMode + bashAllow → apply_patch hâlâ reddedilir", () => {
    const r = checkSubagentPolicy(
      { planMode: true, bashAllow: ["git diff"] },
      "apply_patch",
      {},
    )
    expect(r.allowed).toBe(false)
  })

  it("planMode → read_file izin verilir", () => {
    const r = checkSubagentPolicy({ planMode: true }, "read_file", {})
    expect(r.allowed).toBe(true)
  })

  it("bashDeny prefix eşleşmesi → reddedilir", () => {
    const r = checkSubagentPolicy(
      { bashDeny: ["rm ", "sudo "] },
      "bash",
      { command: "rm -rf /tmp" },
    )
    expect(r.allowed).toBe(false)
  })

  it("bashAllow prefix eşleşmesi → izin verilir", () => {
    const r = checkSubagentPolicy(
      { bashAllow: ["git ", "npm "] },
      "bash",
      { command: "git status" },
    )
    expect(r.allowed).toBe(true)
  })

  it("bashAllow listesinde yok → reddedilir", () => {
    const r = checkSubagentPolicy(
      { bashAllow: ["git "] },
      "bash",
      { command: "rm file" },
    )
    expect(r.allowed).toBe(false)
  })

  it("approvalRequired → requiresApproval:true, allowed:true", () => {
    const r = checkSubagentPolicy({ approvalRequired: ["deploy"] }, "deploy", {})
    expect(r.allowed).toBe(true)
    expect(r.requiresApproval).toBe(true)
  })

  it("bashAllow + temiz argümanlı komut → izin verilir", () => {
    const r = checkSubagentPolicy(
      { bashAllow: ["pnpm test"] },
      "bash",
      { command: "pnpm test src/foo --run" },
    )
    expect(r.allowed).toBe(true)
  })

  it.each([
    ["zincirleme ;", "pnpm test; rm -rf /"],
    ["zincirleme &&", "pnpm test && curl evil"],
    ["pipe |", "pnpm test | sh"],
    ["komut ikamesi $(", "pnpm test $(whoami)"],
    ["backtick", "pnpm test `id`"],
    ["yönlendirme >", "pnpm test > /etc/passwd"],
    ["newline", "pnpm test\nrm -rf /"],
  ])("bashAllow + %s → reddedilir (bypass engeli)", (_label, command) => {
    const r = checkSubagentPolicy({ bashAllow: ["pnpm test"] }, "bash", { command })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/metacharacters/)
  })
})

describe("buildAgentsCatalog", () => {
  it("boş liste → boş string", () => {
    expect(buildAgentsCatalog([])).toBe("")
  })

  it("agent adları listede görünür", () => {
    const agents: AgentDef[] = [
      {
        name: "reviewer",
        description: "Reviews code",
        scope: "user",
        path: "/a",
        policy: {},
      },
    ]
    const out = buildAgentsCatalog(agents)
    expect(out).toContain("reviewer")
    expect(out).toContain("Reviews code")
  })

  it("plugin agent [plugin:id] etiketi alır", () => {
    const agents: AgentDef[] = [
      {
        name: "my-plugin-agent",
        description: "Does stuff",
        scope: "plugin",
        pluginId: "acme-plugin",
        path: "/b",
        policy: {},
      },
    ]
    const out = buildAgentsCatalog(agents)
    expect(out).toContain("[plugin:acme-plugin]")
  })

  it("çok agent → hepsi listelenir", () => {
    const agents: AgentDef[] = [
      { name: "a1", description: "d1", scope: "user", path: "/1", policy: {} },
      { name: "a2", description: "d2", scope: "user", path: "/2", policy: {} },
    ]
    const out = buildAgentsCatalog(agents)
    expect(out).toContain("a1")
    expect(out).toContain("a2")
  })
})
