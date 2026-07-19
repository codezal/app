import { beforeEach, describe, expect, it, vi } from "vitest"

const fsState = vi.hoisted(() => ({
  dirs: {} as Record<string, Array<{ name: string; isDirectory: boolean }>>,
  files: {} as Record<string, string>,
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (path: string) => Object.hasOwn(fsState.dirs, path)),
  readDir: vi.fn(async (path: string) => fsState.dirs[path] ?? []),
  readTextFile: vi.fn(async (path: string) => fsState.files[path] ?? ""),
}))

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/home/user"),
}))

import { readUserSkills, readWorkspaceSkills } from "@/lib/skills/user"
import { buildSkillsCatalog } from "@/lib/skills/parse"
import type { Skill, SkillOrigin } from "@/lib/skills/types"

function addSkill(root: string, name: string): void {
  fsState.dirs[root] = [{ name: "SKILL.md", isDirectory: false }]
  fsState.files[`${root}/SKILL.md`] = `---\nname: ${name}\ndescription: ${name}\n---\nbody`
}

beforeEach(() => {
  fsState.dirs = {}
  fsState.files = {}
})

describe("skill source discovery", () => {
  it("discovers every supported workspace skill directory", async () => {
    addSkill("/workspace/.codezal/skills", "workspace-codezal")
    addSkill("/workspace/.agents/skills", "workspace-agents")
    addSkill("/workspace/.agent/skills", "workspace-agent")
    addSkill("/workspace/.codex/skills", "workspace-codex")
    addSkill("/workspace/.claude/skills", "workspace-claude")

    const skills = await readWorkspaceSkills("/workspace")

    expect(skills.map(({ name, origin, scope }) => ({ name, origin, scope }))).toEqual([
      { name: "workspace-codezal", origin: "codezal", scope: "project" },
      { name: "workspace-agents", origin: "agents", scope: "project" },
      { name: "workspace-agent", origin: "agent", scope: "project" },
      { name: "workspace-codex", origin: "codex", scope: "project" },
      { name: "workspace-claude", origin: "claude", scope: "project" },
    ])
  })

  it("discovers every supported global skill directory", async () => {
    addSkill("/home/user/.codezal/skills", "global-codezal")
    addSkill("/home/user/.agents/skills", "global-agents")
    addSkill("/home/user/.agent/skills", "global-agent")
    addSkill("/home/user/.codex/skills", "global-codex")
    addSkill("/home/user/.claude/skills", "global-claude")

    const skills = await readUserSkills()

    expect(skills.map(({ name, origin, scope }) => ({ name, origin, scope }))).toEqual([
      { name: "global-codezal", origin: "codezal", scope: "global" },
      { name: "global-agents", origin: "agents", scope: "global" },
      { name: "global-agent", origin: "agent", scope: "global" },
      { name: "global-codex", origin: "codex", scope: "global" },
      { name: "global-claude", origin: "claude", scope: "global" },
    ])
  })

  it("labels external skill origins in the model catalog", () => {
    const origins: SkillOrigin[] = ["agents", "agent", "codex", "claude"]
    const skills = origins.map(
      (origin): Skill => ({
        name: `${origin}-skill`,
        description: "",
        path: `/skills/${origin}/SKILL.md`,
        dir: `/skills/${origin}`,
        scope: "global",
        origin,
        body: "body",
        bytes: 4,
      }),
    )

    const catalog = buildSkillsCatalog(skills)

    for (const origin of origins) expect(catalog).toContain(`[${origin}]`)
  })
})
