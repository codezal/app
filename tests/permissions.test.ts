import { describe, it, expect } from "vitest"
import { highRiskPermissions, describePermission } from "@/lib/plugins/permissions"
import type { Permission } from "@/lib/plugins/types"

describe("highRiskPermissions", () => {
  it("boş dizi → boş dizi", () => {
    expect(highRiskPermissions([])).toEqual([])
  })

  it("düşük-risk izinler filtrelenir", () => {
    const perms: Permission[] = ["filesystem.read", "network.fetch", "agents.register"]
    expect(highRiskPermissions(perms)).toEqual([])
  })

  it("shell.exec yüksek-risk", () => {
    expect(highRiskPermissions(["shell.exec"])).toContain("shell.exec")
  })

  it("filesystem.write yüksek-risk", () => {
    expect(highRiskPermissions(["filesystem.write"])).toContain("filesystem.write")
  })

  it("mcp.register yüksek-risk", () => {
    expect(highRiskPermissions(["mcp.register"])).toContain("mcp.register")
  })

  it("hooks.register yüksek-risk", () => {
    expect(highRiskPermissions(["hooks.register"])).toContain("hooks.register")
  })

  it("providers.register yüksek-risk", () => {
    expect(highRiskPermissions(["providers.register"])).toContain("providers.register")
  })

  it("karışık listede sadece yüksek-riskler döner", () => {
    const perms: Permission[] = [
      "filesystem.read",
      "shell.exec",
      "network.fetch",
      "filesystem.write",
    ]
    const high = highRiskPermissions(perms)
    expect(high).toContain("shell.exec")
    expect(high).toContain("filesystem.write")
    expect(high).not.toContain("filesystem.read")
    expect(high).not.toContain("network.fetch")
  })
})

describe("describePermission", () => {
  it("bilinen permission → Türkçe açıklama", () => {
    expect(describePermission("filesystem.read")).toContain("Dosya")
    expect(describePermission("shell.exec")).toContain("Bash")
    expect(describePermission("network.fetch")).toContain("HTTP")
  })

  it("bilinmeyen permission → permission id'si döner", () => {
    expect(describePermission("unknown.perm" as Permission)).toBe("unknown.perm")
  })

  it("tüm geçerli permission'ların açıklaması var", () => {
    const perms: Permission[] = [
      "filesystem.read",
      "filesystem.write",
      "shell.exec",
      "git.exec",
      "network.fetch",
      "agents.register",
      "commands.register",
      "skills.register",
      "mcp.register",
      "hooks.register",
      "providers.register",
    ]
    for (const p of perms) {
      const desc = describePermission(p)
      expect(desc).not.toBe("")
      expect(desc.length).toBeGreaterThan(2)
    }
  })
})
