import type { ProviderId } from "../providers/types"

export type AgentScope = "project" | "global" | "plugin"

//   tools: [list_dir, read_file, ...]        → whitelist
//   deny_tools: [bash, write_file]           → blacklist (whitelist'i override eder)
//   bash_allow: ["git ", "npm test", ...]    → bash komutu prefix listesi
export type SubagentPolicy = {
  tools?: string[]
  denyTools?: string[]
  bashAllow?: string[]
  bashDeny?: string[]
  approvalRequired?: string[]
  planMode?: boolean
}

export type AgentDef = {
  name: string
  description: string
  provider?: ProviderId
  model?: string
  tools?: string[]
  maxSteps?: number
  // Granular permissions
  policy: SubagentPolicy
  path: string
  scope: AgentScope
  systemPrompt: string
  pluginId?: string
}
