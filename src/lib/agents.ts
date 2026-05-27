// Re-export shim — agents/ dizinine taşındı.
export {
  readWorkspaceAgents,
  readUserAgents,
  findAgent,
  listAllAgents,
  parseAgentFile,
  checkSubagentPolicy,
  buildAgentsCatalog,
} from "./agents/index"
export type { AgentDef, AgentScope, SubagentPolicy } from "./agents/types"
