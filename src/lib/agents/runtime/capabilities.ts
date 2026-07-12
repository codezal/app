import type { AgentEngineRef, EngineCapabilities } from "./types"

export function capabilitiesForEngine(engine: AgentEngineRef): EngineCapabilities {
  if (engine.kind === "sdk") {
    return {
      session: "stateless",
      cwd: "per-run",
      tools: "sdk",
      permissions: "codezal",
      usage: "exact",
      cancellation: "cooperative",
    }
  }
  if (engine.kind === "native-cli") {
    return {
      session: "resumable",
      cwd: "fixed-session",
      tools: "mcp",
      permissions: "codezal",
      usage: "partial",
      cancellation: "cooperative",
    }
  }
  return {
    session: "stateless",
    cwd: "per-run",
    tools: "native",
    permissions: "codezal",
    usage: "partial",
    cancellation: "cooperative",
  }
}
