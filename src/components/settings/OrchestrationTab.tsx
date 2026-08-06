// Settings > Agent Orchestration page — full-width home for the supervisor
// section (enable toggle, limits, per-role model pinning). Previously rendered
// at the bottom of the General tab.
import { AgentOrchestrationSection } from "./AgentOrchestrationSection"

export function OrchestrationTab() {
  return (
    <div className="space-y-8">
      <AgentOrchestrationSection />
    </div>
  )
}
