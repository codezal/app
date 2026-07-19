import { buildSkillsPromptSection } from "@/lib/skills"
import type { Settings, Session } from "@/store/types"
import type { CliAgentProviderId } from "."

export async function buildNativeSystemPrompt(args: {
  session: Session
  provider: CliAgentProviderId
  settings: Settings
  recentText?: string
  skillsEnabled: boolean
}): Promise<string> {
  const { session, provider, settings, recentText, skillsEnabled } = args
  const providerLabel = provider === "codex-cli" ? "Codex CLI" : "Claude CLI"
  const mode = session.mode ?? "build"
  const skillsCatalog = skillsEnabled
    ? await buildSkillsPromptSection(session.workspacePath, {
        recentText,
        disabledSkills: settings.disabledSkills,
      })
    : ""

  return [
    `You are running inside Codezal through ${providerLabel}.`,
    `Codezal session mode: ${mode}.`,
    "Use the provider's native tool and permission system. Codezal tools are available through MCP when configured; prefer Codezal code/codemap tools for repository navigation. Reply in the user's language.",
    skillsCatalog,
  ]
    .filter(Boolean)
    .join("\n\n")
}
