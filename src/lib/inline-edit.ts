// Inline (Cmd+K) code edit — rewrites a selected region in the editor from a
// natural-language instruction. Single-shot LLM call, same approach as
// git-ai-commit.ts / session-title.ts: the active session's own provider/model,
// a direct AI SDK call (cheap, never touches the chat transcript).
import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import type { Settings } from "@/store/types"

// Surrounding context sent as read-only reference, capped so a huge file does
// not blow up the prompt. The model must rewrite ONLY the selection.
const CONTEXT_CAP = 2000

const SYSTEM =
  "You are an inline code editor inside an IDE. The user selected a region of a " +
  "file and gave an instruction. Rewrite ONLY the selected region to satisfy the " +
  "instruction. Output ONLY the replacement code for that region — no markdown " +
  "fences, no explanation, no surrounding lines. Preserve the selection's existing " +
  "indentation and the file's style. The PREFIX and SUFFIX are read-only context: " +
  "never repeat them in your output. If the instruction does not apply, return the " +
  "selection unchanged."

// Strip a single wrapping ```lang … ``` fence if the model added one despite the
// instruction. Does NOT touch quotes — code may legitimately start/end with them.
function stripFence(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n")
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(t.trim())
  if (fence) t = fence[1]
  return t
}

export type InlineEditArgs = {
  providerId: ProviderId
  modelId: string
  settings: Settings
  // Hint for the model (file extension or language id, e.g. "ts", "py").
  language: string
  // Text immediately before / after the selection (will be capped).
  prefix: string
  selection: string
  suffix: string
  // Natural-language edit instruction.
  instruction: string
  // Abort the in-flight stream (Esc / cancel).
  signal?: AbortSignal
  // Streamed partial replacement — for live preview in the UI.
  onDelta?: (full: string) => void
}

// Generate the replacement text for the selected region. Throws on LLM/network
// error (caller surfaces it). Returns the (fence-stripped) replacement string.
export async function generateInlineEdit(args: InlineEditArgs): Promise<string> {
  const model = await buildLanguageModel({
    providerId: args.providerId,
    modelId: args.modelId,
    settings: args.settings,
  })

  const prefix = args.prefix.slice(-CONTEXT_CAP)
  const suffix = args.suffix.slice(0, CONTEXT_CAP)
  const prompt =
    `Language: ${args.language || "plain text"}\n\n` +
    `<prefix>\n${prefix}\n</prefix>\n\n` +
    `<selection>\n${args.selection}\n</selection>\n\n` +
    `<suffix>\n${suffix}\n</suffix>\n\n` +
    `Instruction: ${args.instruction}\n\n` +
    `Return only the new code that replaces <selection>.`

  // Gated providers (Kimi For Coding, Z.AI Coding, …) reject a bare generate;
  // the request must look "agent-like". Dummy tool + toolChoice:"none" passes the
  // gate while the model still returns plain text. (Mirror of git-ai-commit.ts.)
  const gated = isCodingAgentGated(args.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined

  const result = streamText({
    model,
    system: SYSTEM,
    prompt,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
    abortSignal: args.signal,
  })

  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
      text += chunk.text ?? ""
      args.onDelta?.(stripFence(text))
    }
  }
  return stripFence(text)
}
