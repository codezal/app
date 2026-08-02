// Contract test for the stream-persistence path in src/lib/stream/run-stream.ts.
//
// runStream persists the NEXT turn's context as `[...history, ...turnMessages]`
// where `turnMessages` comes from the streamText result. The AI SDK exposes two
// different message sets and confusing them silently drops context:
//
//   - `result.response.messages`      → ONLY the FINAL step's messages
//   - `result.responseMessages`       → ALL steps' accumulated response messages
//
// A tool-loop turn is multi-step (tool-call step → answer step). Persisting
// only the final step meant the model's next-turn context lost every earlier
// tool call AND its output — the "what are you talking about" / re-explores
// files it already read symptom. This test pins the AI SDK contract so a
// future `ai` upgrade (or a "simplification" back to `result.response`)
// cannot silently regress the persisted context again.
import { describe, expect, it } from "vitest"
import { streamText, tool } from "ai"
import { z } from "zod"

// The mock model runs in v2 compatibility mode; silence the SDK's warning spam.
;(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false

// Minimal two-step mock model (AI SDK v2 spec):
//   step 1 → tool-call (read_file)           → client tool executes
//   step 2 → final text answer
function mockTwoStepModel() {
  let calls = 0
  return {
    specificationVersion: "v2" as const,
    provider: "mock",
    modelId: "mock-2step",
    defaultObjectGenerationMode: "json" as const,
    async doStream(_args: { messages?: Array<{ content?: unknown }> }) {
      calls++
      const isAnswerStep = calls >= 2
      const chunks = isAnswerStep
        ? [
            { type: "text-start", text: "FINAL ANSWER" },
            { type: "text-delta", delta: "FINAL ANSWER" },
            { type: "text-end", text: "FINAL ANSWER" },
            { type: "model-call-end", finishReason: "stop", usage: { inputTokens: 200, outputTokens: 20 } },
          ]
        : [
            { type: "tool-call", toolCallId: "tc-1", toolName: "read_file", input: JSON.stringify({ path: "a.ts" }) },
            { type: "model-call-end", finishReason: "tool-calls", usage: { inputTokens: 100, outputTokens: 10 } },
          ]
      return {
        response: { id: `resp-${calls}`, modelId: "mock-2step", timestamp: new Date() },
        stream: new ReadableStream<Record<string, unknown>>({
          pull(c) {
            if (chunks.length > 0) c.enqueue(chunks.shift()!)
            else c.close()
          },
        }),
      }
    },
  }
}

describe("streamText multi-step response messages", () => {
  it("result.response.messages contains ONLY the final step (the pitfall)", async () => {
    const result = await streamText({
      model: mockTwoStepModel(),
      messages: [{ role: "user", content: "read a.ts" }],
      tools: {
        read_file: tool({
          description: "r",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => "FILE BODY",
        }),
      },
      stopWhen: async (opts) => opts.steps.length >= 5,
    })
    // Accessing response/responseMessages/steps consumes the stream itself.
    const steps = await result.steps
    expect(steps.length).toBe(2)
    const resp = await result.response
    // Final step = the answer step; the tool-call/tool-result pair is NOT here.
    expect(resp.messages).toHaveLength(1)
    expect(resp.messages[0]).toMatchObject({ role: "assistant" })
  })

  it("result.responseMessages carries the FULL turn incl. tool evidence", async () => {
    const result = await streamText({
      model: mockTwoStepModel(),
      messages: [{ role: "user", content: "read a.ts" }],
      tools: {
        read_file: tool({
          description: "r",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => "FILE BODY",
        }),
      },
      stopWhen: async (opts) => opts.steps.length >= 5,
    })
    const full = await result.responseMessages
    expect(full).toHaveLength(3)
    expect(full[0]).toMatchObject({ role: "assistant", content: [{ type: "tool-call", toolName: "read_file" }] })
    expect(full[1]).toMatchObject({ role: "tool", content: [{ type: "tool-result", toolName: "read_file" }] })
    expect(full[2]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "FINAL ANSWER" }] })

    // What runStream persists for the next turn: previous history + full turn.
    const nextTurnHistory = [
      { role: "user" as const, content: "read a.ts" },
      ...full,
      { role: "user" as const, content: "what did you find?" },
    ]
    const toolEvidence = nextTurnHistory.filter(
      (m) => m.role === "assistant" || m.role === "tool",
    )
    expect(toolEvidence.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string }).type === "tool-call"))).toBe(true)
    expect(toolEvidence.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string }).type === "tool-result"))).toBe(true)
  })
})
