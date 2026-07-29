// Headless Codezal CLI — the harness binary OpenBench drives.
//
// OpenBench's runner copies a task workspace to a temp dir and invokes this
// script with cwd=that dir (see bench/obench-adapter/codezal.py). We run the
// real Codezal agent loop (shared system prompt + tool descriptions — the
// RSI optimization surface), print progress to stderr, and end with one
// machine-parsable stdout line:
//
//   HEADLESS_RESULT {"steps":N,"toolCalls":N,"inputTokens":N,"outputTokens":N,"error":null}
//
// Exit code is 0 when the loop completed — task success is decided by
// OpenBench's checker.sh, never by this process.
//
// Usage:
//   npx tsx bench/headless.ts --provider <id> --model <id> --instruction <text>
//                             [--max-steps N]
import { runAgent } from "./runtime/agent"
import { resolveModel, type ModelRef } from "./runtime/provider"

interface HeadlessArgs {
  provider?: string
  model?: string
  instruction?: string
  maxSteps: number
}

function parseArgs(argv: string[]): HeadlessArgs {
  const out: HeadlessArgs = { maxSteps: 30 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === "--provider") out.provider = next()
    else if (a === "--model") out.model = next()
    else if (a === "--instruction") out.instruction = next()
    else if (a === "--max-steps") out.maxSteps = Number(next())
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.provider || !args.model || !args.instruction) {
    process.stderr.write(
      "usage: headless.ts --provider <id> --model <id> --instruction <text> [--max-steps N]\n",
    )
    process.exit(2)
  }

  const ref: ModelRef = { provider: args.provider, model: args.model }
  // Preflight: fail fast with a clear adapter-visible error when the provider
  // is unknown or the key is missing, instead of dying mid-loop.
  try {
    await resolveModel(ref)
  } catch (e) {
    process.stderr.write(`[headless] model resolution failed: ${e instanceof Error ? e.message : e}\n`)
    process.exit(1)
  }

  const workspace = process.cwd()
  process.stderr.write(`[headless] ${ref.provider}/${ref.model} on ${workspace}\n`)

  const result = await runAgent({
    workspace,
    prompt: args.instruction,
    modelRef: ref,
    maxSteps: args.maxSteps,
  })

  for (const entry of result.transcript) {
    const tag = entry.type === "tool-call" ? `tool:${entry.name}` : entry.type
    process.stderr.write(`[headless] ${tag} ${entry.content.split("\n")[0].slice(0, 200)}\n`)
  }

  const summary = {
    steps: result.steps,
    toolCalls: result.toolCalls,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    error: result.error ?? null,
    finalText: result.finalText.slice(0, 500),
  }
  // Single parseable line on stdout; everything else went to stderr.
  process.stdout.write(`HEADLESS_RESULT ${JSON.stringify(summary)}\n`)
  process.exit(result.error ? 1 : 0)
}

main().catch((e) => {
  process.stderr.write(`[headless] fatal: ${e instanceof Error ? e.stack ?? e.message : e}\n`)
  process.exit(1)
})
