// Agent tipleri — agents/ modülünün ortak contract'ı.
import type { ProviderId } from "../providers/types"

export type AgentScope = "project" | "global" | "plugin"

// Subagent yetki politikası — frontmatter alanları:
//   tools: [list_dir, read_file, ...]        → whitelist
//   deny_tools: [bash, write_file]           → blacklist (whitelist'i override eder)
//   bash_allow: ["git ", "npm test", ...]    → bash komutu prefix listesi
//   bash_deny: ["rm -rf", "curl ", ...]      → bash prefix listesi (her zaman reddedilir)
//   approval_required: [bash, edit_file]     → bu tool'lar her zaman kullanıcı onayı ister
//   plan_mode: true                          → subagent plan modunda başlar
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
  // Opsiyonel — yoksa parent session'ın provider/model'i kullanılır
  provider?: ProviderId
  model?: string
  // Whitelist tool isimleri — yoksa ana setin tümü
  tools?: string[]
  maxSteps?: number
  // Granular permissions
  policy: SubagentPolicy
  path: string
  scope: AgentScope
  systemPrompt: string
  // Plugin kaynaklıysa hangi plugin'den geldiği — UI rozeti için
  pluginId?: string
}
