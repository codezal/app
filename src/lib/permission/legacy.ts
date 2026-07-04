
import type { ApprovalRule } from "@/store/types"
import { permissionKey } from "@/lib/permission-keys"
import { hasGlob } from "@/lib/wildcard"
import type { PermissionAction, Ruleset } from "./types"

export function legacyRulesToRuleset(rules: ApprovalRule[] | undefined): Ruleset {
  if (!rules) return []
  return rules.flatMap((r): Ruleset => {
    const action = r.decision as PermissionAction
    if (action !== "allow" && action !== "deny" && action !== "ask") return []
    const permission = r.tool === "*" ? "*" : permissionKey(r.tool)
    let pattern = r.pattern ?? "*"
    if (r.pattern && !hasGlob(r.pattern)) pattern = r.pattern + "*"
    return [{ permission, pattern, action }]
  })
}
