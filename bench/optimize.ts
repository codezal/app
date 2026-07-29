// RSI loop over the internal bench suite — an optimizer model iteratively
// improves the shared harness prompt files; every candidate is gated by the
// deterministic benchmark. The loop machinery lives in optimizer-core.ts;
// this file is the internal-suite backend + CLI.
//
// Usage:
//   npm run bench:optimize -- --provider <id> --model <id>
//     [--optimizer-provider <id> --optimizer-model <id>] [--max-iterations N]
//     [--quick|--full|--hard] [--dry-run] [--allow-system-prompt] [--allow-dirty]
//     [--time-budget-min N]
//
// Provider ids + credentials resolve like `npm run bench` (see --list there).
// Env equivalents: BENCH_PROVIDER/BENCH_MODEL (agent under test),
//      OPTIMIZER_PROVIDER/OPTIMIZER_MODEL (defaults to the BENCH_* pair).
import { loadConfig, loadTasks, runSuite, saveResult, type SuiteResult } from "./run"
import { runOptimizeLoop, type OptimizerScore } from "./optimizer-core"

interface OptimizeArgs {
  maxIterations: number
  quick: boolean
  hard: boolean
  dryRun: boolean
  allowSystemPrompt: boolean
  allowDirty: boolean
  timeBudgetMin: number
}

function parseArgs(argv: string[]): OptimizeArgs {
  const args: OptimizeArgs = {
    maxIterations: 10,
    quick: true,
    hard: false,
    dryRun: false,
    allowSystemPrompt: false,
    allowDirty: false,
    timeBudgetMin: 0,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--max-iterations") args.maxIterations = Number(argv[++i])
    else if (a === "--quick") { args.quick = true; args.hard = false }
    else if (a === "--full") { args.quick = false; args.hard = false }
    else if (a === "--hard") { args.hard = true; args.quick = false }
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--allow-system-prompt") args.allowSystemPrompt = true
    else if (a === "--allow-dirty") args.allowDirty = true
    else if (a === "--time-budget-min") args.timeBudgetMin = Number(argv[++i])
    else if (a === "--provider") process.env.BENCH_PROVIDER = argv[++i]
    else if (a === "--model") process.env.BENCH_MODEL = argv[++i]
    else if (a === "--optimizer-provider") process.env.OPTIMIZER_PROVIDER = argv[++i]
    else if (a === "--optimizer-model") process.env.OPTIMIZER_MODEL = argv[++i]
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run bench:optimize -- --provider <id> --model <id>\n" +
          "  [--optimizer-provider <id> --optimizer-model <id>] [--max-iterations N]\n" +
          "  [--quick|--full|--hard] [--dry-run] [--allow-system-prompt] [--allow-dirty]\n" +
          "  [--time-budget-min N]",
      )
      process.exit(0)
    }
  }
  return args
}

function summarizeFailures(result: SuiteResult, maxTranscriptChars: number): string {
  const failed = result.runs.filter((r) => !r.passed)
  if (failed.length === 0) return "All tasks passed."
  return failed
    .map((r) => {
      const tail = r.transcript
        .slice(-8)
        .map((t) => `[${t.type}${t.name ? ` ${t.name}` : ""}] ${t.content.slice(0, 400)}`)
        .join("\n")
      const truncatedTail = tail.slice(0, maxTranscriptChars)
      return (
        `### ${r.taskId} (run ${r.run}) — FAIL\n` +
        `verify failures: ${r.verifyFailures.join(" | ") || "(none)"}\n` +
        `steps: ${r.steps}, tool calls: ${r.toolCalls}\n` +
        `transcript tail:\n${truncatedTail}`
      )
    })
    .join("\n\n")
}

function toScore(result: SuiteResult): OptimizerScore {
  return {
    passRate: result.passRate,
    passed: result.passed,
    total: result.total,
    tokens: result.totalInputTokens + result.totalOutputTokens,
    failureSummary: summarizeFailures(result, 2000),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()

  const allTasks = await loadTasks()
  const suiteName = args.hard ? "hard" : args.quick ? "quick" : "full"
  const tasks = args.hard
    ? allTasks.filter((t) => t.difficulty === "hard")
    : args.quick
      ? allTasks.filter((t) => config.quickTasks.includes(t.id))
      : allTasks
  const suiteOpts = { tasks, repeat: config.repeat, maxSteps: config.maxSteps }

  await runOptimizeLoop({
    config,
    suiteName,
    taskCount: tasks.length,
    maxIterations: args.maxIterations,
    dryRun: args.dryRun,
    allowSystemPrompt: args.allowSystemPrompt,
    allowDirty: args.allowDirty,
    timeBudgetMin: args.timeBudgetMin,
    measure: async (onProgress) => {
      const result = await runSuite({ ...suiteOpts, onProgress })
      await saveResult(result)
      return toScore(result)
    },
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
