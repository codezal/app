import { describe, it, expect } from "vitest"
import { evaluate, merge, fromConfig, legacyRulesToRuleset } from "@/lib/permission"
import { permissionKey } from "@/lib/permission-keys"
import { modePresetRuleset } from "@/lib/permission/presets"
import type { ApprovalRule } from "@/store/types"

describe("evaluate — findLast + default ask", () => {
  it("eşleşme yoksa ask", () => {
    expect(evaluate("edit", "/a.ts", []).action).toBe("ask")
  })

  it("son eşleşen kural kazanır (allow → deny)", () => {
    const rs = fromConfig({ bash: { "git *": "allow", "git push*": "deny" } })
    expect(evaluate("bash", "git status", rs).action).toBe("allow")
    expect(evaluate("bash", "git push origin", rs).action).toBe("deny")
  })

  it("ask, allowlist içinde istisna oyar", () => {
    const rs = fromConfig({ bash: { "git *": "allow", "git push*": "ask" } })
    expect(evaluate("bash", "git push --force", rs).action).toBe("ask")
  })

  it("'*' permission her key'i eşler", () => {
    const rs = fromConfig({ "*": "allow" })
    expect(evaluate("edit", "/x", rs).action).toBe("allow")
    expect(evaluate("bash", "ls", rs).action).toBe("allow")
  })

  it("merge sırası önceliktir — sonraki ruleset ezer", () => {
    const base = fromConfig({ "*": "ask" })
    const over = fromConfig({ edit: "allow" })
    expect(evaluate("edit", "/x", merge(base, over)).action).toBe("allow")
    expect(evaluate("bash", "ls", merge(base, over)).action).toBe("ask")
  })
})

describe("fromConfig — kısayol + object", () => {
  it("string kısayol → key/*/action", () => {
    expect(fromConfig({ edit: "deny" })).toEqual([{ permission: "edit", pattern: "*", action: "deny" }])
  })
  it("object → her pattern bir kural", () => {
    expect(fromConfig({ bash: { "git *": "allow", "rm *": "deny" } })).toEqual([
      { permission: "bash", pattern: "git *", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ])
  })
})

describe("permissionKey — capability map", () => {
  it("edit ailesi tek key'e map'lenir", () => {
    expect(permissionKey("edit_file")).toBe("edit")
    expect(permissionKey("write_file")).toBe("edit")
    expect(permissionKey("apply_patch")).toBe("edit")
  })
  it("eşleşmeyen tool kendi adıyla key olur", () => {
    expect(permissionKey("code_search")).toBe("code_search")
  })
})

describe("legacyRulesToRuleset — eski model köprüsü", () => {
  it("glob'suz pattern → startsWith eşdeğeri ('*' eklenir)", () => {
    const rules: ApprovalRule[] = [{ tool: "bash", pattern: "git ", decision: "allow" }]
    const rs = legacyRulesToRuleset(rules)
    expect(evaluate("bash", "git status", rs).action).toBe("allow")
    expect(evaluate("bash", "npm i", rs).action).toBe("ask")
  })
  it("tool adı capability key'e çevrilir", () => {
    const rules: ApprovalRule[] = [{ tool: "write_file", pattern: "/repo*", decision: "deny" }]
    const rs = legacyRulesToRuleset(rules)
    expect(evaluate("edit", "/repo/x.ts", rs).action).toBe("deny")
  })
  it("tool '*' → permission '*'", () => {
    const rules: ApprovalRule[] = [{ tool: "*", decision: "allow" }]
    expect(evaluate("anything", "/x", legacyRulesToRuleset(rules)).action).toBe("allow")
  })
})

describe("modePresetRuleset — mode → ruleset", () => {
  it("bypass → hepsi allow", () => {
    expect(evaluate("bash", "rm -rf", modePresetRuleset("bypass")).action).toBe("allow")
  })
  it("ask → hepsi ask", () => {
    expect(evaluate("edit", "/x", modePresetRuleset("ask")).action).toBe("ask")
  })
  it("auto-review → okuma/edit allow, bash ask", () => {
    const rs = modePresetRuleset("auto-review")
    expect(evaluate("read", "/x", rs).action).toBe("allow")
    expect(evaluate("edit", "/x", rs).action).toBe("allow")
    expect(evaluate("bash", "ls", rs).action).toBe("ask")
  })
})
