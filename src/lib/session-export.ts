import type { Message, Part } from "@/store/types"
import type { Session } from "@/store/types"

function partsToMarkdown(parts: Part[]): string {
  const lines: string[] = []
  for (const p of parts) {
    if (p.type === "text") {
      lines.push(p.text)
    } else if (p.type === "reasoning") {
      lines.push(`<details>\n<summary>Reasoning</summary>\n\n${p.text}\n</details>`)
    } else if (p.type === "tool-call") {
      const input = JSON.stringify(p.input, null, 2)
      lines.push(`**Tool:** \`${p.toolName}\`\n\`\`\`json\n${input}\n\`\`\``)
    } else if (p.type === "tool-result") {
      const out = p.output.length > 2000 ? p.output.slice(0, 2000) + "\n… (truncated)" : p.output
      lines.push(`**Result:**\n\`\`\`\n${out}\n\`\`\``)
    }
  }
  return lines.join("\n\n")
}

function messageToMarkdown(msg: Message): string {
  const roleLabel = msg.role === "user" ? "**You**" : msg.role === "assistant" ? "**Assistant**" : "**System**"
  const body = msg.parts && msg.parts.length > 0
    ? partsToMarkdown(msg.parts)
    : msg.content

  return `${roleLabel}\n\n${body}`
}

export function sessionToMarkdown(session: Session): string {
  const lines: string[] = []

  lines.push(`# ${session.title || "Untitled Session"}`)
  if (session.workspacePath) {
    lines.push(`\n**Workspace:** \`${session.workspacePath}\``)
  }
  lines.push(`\n---\n`)

  for (const msg of session.messages) {
    if (msg.role === "system") continue
    lines.push(messageToMarkdown(msg))
    lines.push("\n---\n")
  }

  return lines.join("\n")
}

export async function copySessionToClipboard(session: Session): Promise<void> {
  const md = sessionToMarkdown(session)
  await navigator.clipboard.writeText(md)
}
