// Next-edit prediction — Copilot / Cursor-Tab-style inline completion. A fast
// model predicts what to insert at the cursor from the surrounding code; Monaco
// renders it as ghost text and Tab accepts it.
//
// Direct one-shot AI SDK call (inline-edit.ts / git-ai-commit.ts pattern): uses
// the active session's provider with an auto-picked small/fast model so a
// per-keystroke suggestion is cheap and quick. Opt-in via localStorage (no
// settings-schema dependency); default OFF (it spends tokens as you type).
import * as monaco from "monaco-editor"
import { streamText, tool, stepCountIs } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import { pickSmallModel } from "@/lib/small-model"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"

const NE_KEY = "codezal:next-edit:v1"
const PREFIX_CAP = 3000
const SUFFIX_CAP = 1000
const DEBOUNCE_MS = 180
const MIN_PREFIX = 3

const LANGUAGES = [
  "typescript", "javascript", "json", "markdown", "css", "scss", "less",
  "html", "xml", "python", "rust", "go", "java", "kotlin", "php", "sql",
  "yaml", "c", "cpp", "shell", "ruby", "ini", "swift", "dockerfile",
  "graphql", "plaintext",
]

export function nextEditEnabled(): boolean {
  try {
    return localStorage.getItem(NE_KEY) === "1"
  } catch {
    return false
  }
}

export function setNextEditEnabled(on: boolean): void {
  try {
    localStorage.setItem(NE_KEY, on ? "1" : "0")
  } catch {
    // Intentionally ignored.
  }
}

const SYSTEM =
  "You are a code autocomplete engine inside an IDE. You are given the code BEFORE " +
  "the cursor (<prefix>) and AFTER the cursor (<suffix>). Output ONLY the raw text " +
  "to insert at the cursor so the code continues naturally. No markdown fences, no " +
  "commentary, never repeat the prefix or suffix. Keep it short — usually finish the " +
  "current line or a small block. If nothing useful should be inserted, output nothing."

function stripFence(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n")
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(t.trim())
  return fence ? fence[1] : t
}

export type NextEditArgs = {
  language: string
  prefix: string
  suffix: string
  signal?: AbortSignal
}

export async function predictNextEdit(args: NextEditArgs): Promise<string> {
  const settings = useSettingsStore.getState().settings
  const sess = useSessionsStore.getState().active
  const providerId = (sess?.provider ?? settings.defaultProvider) as ProviderId
  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const small = pickSmallModel(catalog, providerId)
  const modelId = small ?? (providerId === "local" ? (sess?.model ?? settings.defaultModel) : null)
  if (!modelId) return ""

  const model = await buildLanguageModel({ providerId, modelId, settings })
  const prefix = args.prefix.slice(-PREFIX_CAP)
  const suffix = args.suffix.slice(0, SUFFIX_CAP)
  const gated = isCodingAgentGated(providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined
  const result = streamText({
    model,
    system: SYSTEM,
    prompt:
      `Language: ${args.language || "plain text"}\n\n` +
      `<prefix>\n${prefix}\n</prefix>\n\n` +
      `<suffix>\n${suffix}\n</suffix>`,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: stepCountIs(1),
    abortSignal: args.signal,
  })
  let text = ""
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text ?? ""
  }
  return stripFence(text)
}

function wait(ms: number, token: monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) return resolve(false)
    const id = setTimeout(() => resolve(true), ms)
    token.onCancellationRequested(() => {
      clearTimeout(id)
      resolve(false)
    })
  })
}

let registered = false
export function registerNextEditProvider(): void {
  if (registered) return
  registered = true
  monaco.languages.registerInlineCompletionsProvider(LANGUAGES, {
    provideInlineCompletions: async (model, position, _context, token) => {
      if (!nextEditEnabled()) return { items: [] }
      const offset = model.getOffsetAt(position)
      const full = model.getValue()
      const prefix = full.slice(0, offset)
      if (prefix.trim().length < MIN_PREFIX) return { items: [] }
      const suffix = full.slice(offset)

      if (!(await wait(DEBOUNCE_MS, token))) return { items: [] }

      const ac = new AbortController()
      token.onCancellationRequested(() => ac.abort())
      let insert: string
      try {
        insert = await predictNextEdit({
          language: model.getLanguageId(),
          prefix,
          suffix,
          signal: ac.signal,
        })
      } catch {
        return { items: [] }
      }
      if (!insert || token.isCancellationRequested) return { items: [] }
      return {
        items: [
          {
            insertText: insert,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
          },
        ],
      }
    },
    disposeInlineCompletions: () => {
    },
  })
}
