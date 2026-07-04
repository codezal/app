// opencode packages/core/src/permission.ts portu — evaluate (findLast) + merge.

import { wildcardMatch } from "@/lib/wildcard"
import type { PermissionRule, Ruleset } from "./types"

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): PermissionRule {
  return (
    rulesets
      .flat()
      .findLast((r) => wildcardMatch(permission, r.permission) && wildcardMatch(pattern, r.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}
