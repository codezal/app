import { beforeEach, describe, expect, it, vi } from "vitest"

const mockBuildSkillsPromptSection = vi.hoisted(() => vi.fn())

vi.mock("@/lib/skills", () => ({
  buildSkillsPromptSection: mockBuildSkillsPromptSection,
}))

import { buildNativeSystemPrompt } from "@/lib/agent-providers/native-prompt"
import type { Settings, Session } from "@/store/types"

beforeEach(() => {
  mockBuildSkillsPromptSection.mockReset()
  mockBuildSkillsPromptSection.mockResolvedValue(
    "# Available Skills (on-demand)\n- **reviewer**: Reviews code",
  )
})

describe("buildNativeSystemPrompt", () => {
  it.each(["codex-cli", "claude-cli"] as const)(
    "%s receives the shared skill catalog",
    async (provider) => {
      const result = await buildNativeSystemPrompt({
        session: { mode: "build", workspacePath: "/workspace" } as Session,
        provider,
        settings: { disabledSkills: ["disabled"] } as Settings,
        recentText: "Review this change",
        skillsEnabled: true,
      })

      expect(result).toContain("Available Skills")
      expect(mockBuildSkillsPromptSection).toHaveBeenCalledWith("/workspace", {
        recentText: "Review this change",
        disabledSkills: ["disabled"],
      })
    },
  )

  it("omits the catalog when Codezal tools are disabled", async () => {
    const result = await buildNativeSystemPrompt({
      session: { mode: "build", workspacePath: "/workspace" } as Session,
      provider: "codex-cli",
      settings: {} as Settings,
      skillsEnabled: false,
    })

    expect(result).not.toContain("Available Skills")
    expect(mockBuildSkillsPromptSection).not.toHaveBeenCalled()
  })
})
