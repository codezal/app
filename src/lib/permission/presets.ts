
import type { ApprovalMode, AgentMode } from "@/store/types"
import { fromConfig } from "./config"
import type { Ruleset } from "./types"

export function defaultsRuleset(): Ruleset {
  return []
}

export function modePresetRuleset(mode: ApprovalMode): Ruleset {
  if (mode === "bypass") return fromConfig({ "*": "allow" })
  if (mode === "ask") return fromConfig({ "*": "ask" })
  // todo_write/edit_file/write_file → capability key'ler: read/list/search/grep/find/glob/
  // todowrite/edit. bash ve kalan tool'lar (webfetch/task/...) "*": "ask" ile sorulur.
  return fromConfig({
    "*": "ask",
    read: "allow",
    list: "allow",
    search: "allow",
    grep: "allow",
    find: "allow",
    glob: "allow",
    todowrite: "allow",
    edit: "allow",
  })
}

export function agentModeRuleset(_mode: AgentMode | undefined): Ruleset {
  return []
}
