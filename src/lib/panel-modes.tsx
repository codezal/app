import type React from "react"
import {
  Bot,
  Folder as FolderIcon,
  GitBranch,
  GitPullRequest,
  Globe,
  ListChecks,
  Notebook,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
} from "@/lib/icons"
import { t as tStatic } from "@/lib/i18n"

export type PanelMode =
  | "files"
  | "git"
  | "review"
  | "agents"
  | "skills"
  | "memory"
  | "rules"
  | "terminal"
  | "preview"
  | "todo"
  | "suggestions"
  | "sdd"

export function modeLabel(m: PanelMode): string {
  switch (m) {
    case "files": return tStatic("tabBar.modeFiles")
    case "git": return tStatic("tabBar.modeGit")
    case "review": return tStatic("prPanel.aiReview")
    case "agents": return tStatic("tabBar.modeAgents")
    case "skills": return tStatic("tabBar.modeSkills")
    case "memory": return tStatic("tabBar.modeMemory")
    case "rules": return tStatic("tabBar.modeRules")
    case "terminal": return tStatic("tabBar.modeTerminal")
    case "preview": return tStatic("tabBar.modePreview")
    case "todo": return tStatic("tabBar.modeTodo")
    case "suggestions": return tStatic("tabBar.modeSuggestions")
    case "sdd": return tStatic("sdd.panelTitle")
  }
}

// Modes the AI surfaces on its own while working (agent runs, todo bursts,
// browser previews). They are transient: opened by the AI, closed when the run
// ends — the toggle must never resurrect them afterwards.
export const AI_TRANSIENT_MODES: ReadonlySet<PanelMode> = new Set(["agents", "todo", "preview"])

// The right-panel toggle re-opens the last open mode, but some modes must not
// come back that way:
// - "todo" / "suggestions" are session-bound: re-opening them in a chat that
//   has nothing to show would surface an empty pane.
// - "agents" / "preview" are AI-transient: they appear while the AI works and
//   close when it finishes, so re-opening falls back to the files panel.
export function resolvePanelReopenMode(
  last: PanelMode,
  opts: { hasActiveTodos: boolean; hasSuggestions: boolean },
): PanelMode {
  if (last === "agents" || last === "preview") return "files"
  if (last === "todo" && !opts.hasActiveTodos) return "files"
  if (last === "suggestions" && !opts.hasSuggestions) return "files"
  return last
}

export const MODE_ICON: Record<PanelMode, React.ComponentType<{ className?: string }>> = {
  files: FolderIcon,
  git: GitBranch,
  review: GitPullRequest,
  agents: Bot,
  skills: Sparkles,
  memory: Notebook,
  rules: ShieldCheck,
  terminal: TerminalIcon,
  preview: Globe,
  todo: ListChecks,
  suggestions: Sparkles,
  sdd: Notebook,
}
