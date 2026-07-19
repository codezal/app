import {
  terminalAvailablePrograms,
  type TerminalAvailableProgram,
} from "@/lib/exec"

export type TerminalCliId =
  | "codex"
  | "claude"
  | "opencode"
  | "grok"
  | "gemini"
  | "kimi"
  | "aider"
  | "goose"

export type TerminalCliDefinition = {
  id: TerminalCliId
  label: string
  command: string
  launchCommand?: string
}

export const TERMINAL_CLI_TOOLS: readonly TerminalCliDefinition[] = [
  { id: "codex", label: "Codex", command: "codex" },
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "opencode", label: "OpenCode", command: "opencode" },
  { id: "grok", label: "Grok", command: "grok" },
  { id: "gemini", label: "Gemini CLI", command: "gemini" },
  { id: "kimi", label: "Kimi CLI", command: "kimi" },
  { id: "aider", label: "Aider", command: "aider" },
  { id: "goose", label: "Goose", command: "goose" },
]

export async function detectInstalledTerminalCliTools(
  available: (commands: string[]) => Promise<TerminalAvailableProgram[]> = terminalAvailablePrograms,
): Promise<TerminalCliDefinition[]> {
  const commands = TERMINAL_CLI_TOOLS.map((tool) => tool.command)
  const installed = new Map((await available(commands)).map((program) => [program.name, program]))
  return TERMINAL_CLI_TOOLS.flatMap((tool) => {
    const program = installed.get(tool.command)
    return program ? [{ ...tool, launchCommand: program.launchCommand }] : []
  })
}
