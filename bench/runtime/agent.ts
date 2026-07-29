// Headless agent loop for the benchmark harness.
//
// Uses the REAL shared optimization surface: the app's BASE_SYSTEM prompt
// (src/lib/prompts/base-system.ts, statically imported — each bench run is a
// fresh process so optimizer edits apply) and the shared tool descriptions
// (src/lib/tools/prompts/*.txt, re-read per run).
import { generateText, isStepCount } from "ai"
import { BASE_SYSTEM } from "../../src/lib/prompts/base-system"
import { applySharedDescriptions, buildBenchTools } from "./tools"
import { resolveModel, type ModelRef } from "./provider"

export interface AgentRunResult {
  finalText: string
  steps: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  transcript: TranscriptEntry[]
  error?: string
}

export interface TranscriptEntry {
  type: "text" | "tool-call" | "tool-result"
  name?: string
  content: string
}

const BENCH_ADDENDUM = `## Bench environment
You are running headless (no UI, no user). Rules:
- The workspace contains only the files for this task. Work entirely inside it.
- Never ask the user questions — make a reasonable decision and proceed.
- Do not use git, do not install packages, do not access the network.
- When the task is done, reply with a one-line summary and stop.`

export async function runAgent(opts: {
  workspace: string
  prompt: string
  modelRef: ModelRef
  maxSteps: number
}): Promise<AgentRunResult> {
  const tools = buildBenchTools(opts.workspace)
  await applySharedDescriptions(tools)

  const transcript: TranscriptEntry[] = []
  let toolCalls = 0

  try {
    const result = await generateText({
      model: await resolveModel(opts.modelRef),
      system: `${BASE_SYSTEM}\n\n${BENCH_ADDENDUM}`,
      prompt: opts.prompt,
      tools,
      stopWhen: isStepCount(opts.maxSteps),
      onStepFinish: (step) => {
        for (const tc of step.toolCalls) {
          toolCalls++
          transcript.push({ type: "tool-call", name: tc.toolName, content: JSON.stringify(tc.input).slice(0, 2000) })
        }
        for (const tr of step.toolResults) {
          const out = typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output)
          transcript.push({ type: "tool-result", name: tr.toolName, content: out.slice(0, 2000) })
        }
        if (step.text) {
          transcript.push({ type: "text", content: step.text.slice(0, 4000) })
        }
      },
    })

    return {
      finalText: result.text,
      steps: result.steps.length,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      toolCalls,
      transcript,
    }
  } catch (e) {
    return {
      finalText: "",
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls,
      transcript,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
