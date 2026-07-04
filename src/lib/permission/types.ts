// Rule = { permission (capability-key), pattern (glob), action }. Ruleset = Rule[].

export type PermissionAction = "allow" | "deny" | "ask"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type Ruleset = PermissionRule[]
