import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/memory", () => ({
  readProjectMemory: vi.fn().mockResolvedValue([]),
  readUserMemory: vi.fn().mockResolvedValue([]),
  readConfiguredInstructions: vi.fn().mockResolvedValue([]),
  buildMemorySystemPrompt: vi.fn().mockReturnValue(""),
}))
vi.mock("@/lib/skills", () => ({
  readWorkspaceSkills: vi.fn().mockResolvedValue([]),
  readUserSkills: vi.fn().mockResolvedValue([]),
  buildSkillsCatalog: vi.fn().mockReturnValue(""),
}))
vi.mock("@/lib/skills/plugin", () => ({
  listPluginSkills: vi.fn().mockReturnValue([]),
}))
vi.mock("@/lib/agents", () => ({
  readWorkspaceAgents: vi.fn().mockResolvedValue([]),
  readUserAgents: vi.fn().mockResolvedValue([]),
  buildAgentsCatalog: vi.fn().mockReturnValue(""),
}))
vi.mock("@/lib/agents/plugin", () => ({
  listPluginAgents: vi.fn().mockReturnValue([]),
}))
vi.mock("@/lib/token-savers", () => ({
  briefModeSection: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/i18n", () => ({
  useI18nStore: { getState: vi.fn().mockReturnValue({ locale: "en" }) },
  languageName: (c: string) =>
    (({ en: "English", tr: "Turkish" }) as Record<string, string>)[c] ?? "English",
}))
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({
      settings: { narrateProgress: true },
    }),
  },
}))

import { buildMemoryPromptSections, buildSystemPrompt } from "@/lib/system-prompt"
import { useI18nStore } from "@/lib/i18n"
import { useSettingsStore } from "@/store/settings"
import { briefModeSection } from "@/lib/token-savers"
import { buildMemorySystemPrompt, readProjectMemory } from "@/lib/memory"

const mockI18n = vi.mocked(useI18nStore.getState)
const mockSettings = vi.mocked(useSettingsStore.getState)
const mockBrief = vi.mocked(briefModeSection)
const mockBuildMemory = vi.mocked(buildMemorySystemPrompt)
const mockReadProjectMemory = vi.mocked(readProjectMemory)

beforeEach(() => {
  vi.clearAllMocks()
  mockI18n.mockReturnValue({ locale: "en" } as ReturnType<typeof useI18nStore.getState>)
  mockSettings.mockReturnValue({
    settings: { narrateProgress: true },
  } as ReturnType<typeof useSettingsStore.getState>)
  mockBrief.mockReturnValue(null)
})

describe("buildSystemPrompt", () => {
  it("base sistem prompt her zaman dahil edilir", async () => {
    const r = await buildSystemPrompt({})
    expect(r).toContain("Codezal")
    expect(r).toContain("tools")
  })

  it("workspace path dahil edilir", async () => {
    const r = await buildSystemPrompt({ workspacePath: "/my/project" })
    expect(r).toContain("/my/project")
  })

  it("model label dahil edilir", async () => {
    const r = await buildSystemPrompt({ modelLabel: "anthropic/claude-opus-4-7" })
    expect(r).toContain("claude-opus-4-7")
  })

  it("İngilizce locale → English dil direktifi", async () => {
    mockI18n.mockReturnValue({ locale: "en" } as ReturnType<typeof useI18nStore.getState>)
    const r = await buildSystemPrompt({})
    expect(r).toContain("English")
  })

  it("Türkçe locale → Turkish dil direktifi", async () => {
    mockI18n.mockReturnValue({ locale: "tr" } as ReturnType<typeof useI18nStore.getState>)
    const r = await buildSystemPrompt({})
    expect(r).toContain("Turkish")
  })

  it("narrateProgress: true → narrasyon politikası dahil", async () => {
    mockSettings.mockReturnValue({
      settings: { narrateProgress: true },
    } as ReturnType<typeof useSettingsStore.getState>)
    const r = await buildSystemPrompt({})
    expect(r.toLowerCase()).toContain("narrat")
  })

  it("narrateProgress: false → narrasyon politikası dahil değil", async () => {
    mockSettings.mockReturnValue({
      settings: { narrateProgress: false },
    } as ReturnType<typeof useSettingsStore.getState>)
    const r = await buildSystemPrompt({})
    expect(r).not.toContain("## Progress narration")
  })

  it("brief mode direktifi dahil edilir (mock döndürünce)", async () => {
    mockBrief.mockReturnValue("## BRIEF MODE — FULL\nBe concise.")
    const r = await buildSystemPrompt({ tokenSavers: { briefMode: { enabled: true, level: "full" }, compactOutput: { enabled: false, filters: { git: true, test: true, build: true, grep: true, lint: true, pkg: true, generic: true } }, codeMap: { enabled: false, autoReindex: true, languages: [] } } })
    expect(r).toContain("BRIEF MODE")
  })

  it("plan modu → PLAN MODE ACTIVE bloğu", async () => {
    const r = await buildSystemPrompt({ mode: "plan" })
    expect(r).toContain("PLAN MODE ACTIVE")
    expect(r).toContain("read-only")
  })

  it("build modu (varsayılan) → PLAN MODE ACTIVE yok", async () => {
    const r = await buildSystemPrompt({ mode: "build" })
    expect(r).not.toContain("PLAN MODE ACTIVE")
  })

  it("memory sections memory priority ile modele empoze edilir", async () => {
    mockReadProjectMemory.mockResolvedValue([
      { path: "/ws/AGENTS.md", name: "AGENTS.md", scope: "project", content: "Follow repo rules.", bytes: 18 },
    ])
    mockBuildMemory.mockReturnValue("# Aktif Bellek\nFollow repo rules.")
    const sections = await buildMemoryPromptSections({ workspacePath: "/ws" })
    const joined = sections.join("\n")
    expect(joined).toContain("## Memory Priority")
    expect(joined).toContain("Current user instructions override memory")
    expect(joined).toContain("Follow repo rules.")
  })

  it("orchestra modu + workers → ORCHESTRA MODE ACTIVE bloğu", async () => {
    const r = await buildSystemPrompt({
      mode: "orchestra",
      orchestra: {
        workers: [
          { idx: 0, kind: "sdk", provider: "anthropic", model: "claude-haiku-4-5" },
        ],
      },
    })
    expect(r).toContain("ORCHESTRA MODE ACTIVE")
    expect(r).toContain("worker-0")
  })

  it("activeGoal → ACTIVE GOAL bloğu + sentinel açıklaması", async () => {
    const r = await buildSystemPrompt({
      activeGoal: { text: "Refactor auth module", iter: 0, maxIter: 5 },
    })
    expect(r).toContain("ACTIVE GOAL")
    expect(r).toContain("Refactor auth module")
    expect(r).toContain("[GOAL_DONE]")
    expect(r).toContain("1/5")
  })

  it("activeGoal yok → ACTIVE GOAL bloğu yok", async () => {
    const r = await buildSystemPrompt({})
    expect(r).not.toContain("ACTIVE GOAL")
  })

  it("activeGoal paused → PAUSED bloğu, autonomous-loop framing'i yok", async () => {
    const r = await buildSystemPrompt({
      activeGoal: { text: "Refactor auth module", iter: 2, maxIter: 5, paused: true },
    })
    expect(r).toContain("ACTIVE GOAL (PAUSED)")
    expect(r).toContain("Refactor auth module")
    expect(r).not.toContain("the harness will automatically send")
    expect(r).toContain("2/5")
  })

  it("mcpInstructions toplam bütçe → fazlası atlanır + not düşülür", async () => {
    const big = "x".repeat(5000)
    const r = await buildSystemPrompt({
      mcpInstructions: Array.from({ length: 5 }, (_, i) => ({ server: `srv${i}`, text: big })),
    })
    expect(r).toContain("### srv0")
    expect(r).toContain("### srv1")
    expect(r).not.toContain("### srv4")
    expect(r).toContain("3 more servers' instructions omitted")
  })

  it("claude model → claude narrasyon overlay'i", async () => {
    const r = await buildSystemPrompt({ modelLabel: "anthropic/claude-sonnet-4-6" })
    // Narration on (default) + claude family → claude overlay
    expect(r).toContain("Narration style")
  })

  it("kimi model → kimi narrasyon overlay'i (zorunlu)", async () => {
    const r = await buildSystemPrompt({ modelLabel: "kimi/kimi-k2" })
    expect(r).toContain("required")
  })
})
