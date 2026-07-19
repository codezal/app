import type React from "react"
import {
  Bot,
  Folder as FolderIcon,
  GitBranch,
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

export const MODE_ICON: Record<PanelMode, React.ComponentType<{ className?: string }>> = {
  files: FolderIcon,
  git: GitBranch,
  review: GitBranch,
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
