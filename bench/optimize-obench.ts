// RSI loop scored by OpenBench (github.com/minghinmatthewlam/openbench) —
// the Codezal harness runs as an external CLI against OpenBench's task suite
// (core synthetic + Exercism tiers; the Terminal-Bench tier needs Docker).
//
// The agent under test is bench/headless.ts via bench/obench-adapter/
// codezal.py, so the optimized surface is exactly the same shared harness
// text (tool descriptions / system prompt) as the internal loop.
//
// Setup (one time):
//   bench/vendor/openbench is expected to contain the OpenBench source with a
//   uv venv at .venv (Python 3.12) and `uv pip install -e .` done.
//
// Usage:
//   npm run bench:optimize:obench -- --model qwen3.8-max
//     [--optimizer-provider <id> --optimizer-model <id>]
//     [--tasks a,b,c] [--trials N] [--timeout S] [--max-iterations N]
//     [--dry-run] [--allow-system-prompt] [--allow-dirty] [--time-budget-min N]
//
// --model is an OpenBench canonical name mapped in the adapter
// (qwen3.8-max | deepseek-v4-pro | kimi-k3) or pass-through "provider/model".
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { loadConfig } from "./run"
import { REPO_ROOT, RESULTS_DIR, runOptimizeLoop, type OptimizerScore } from "./optimizer-core"

const OBENCH_DIR = path.join(REPO_ROOT, "bench/vendor/openbench")
const OBENCH_BIN = path.join(OBENCH_DIR, ".venv/bin/obench")
const ADAPTERS_DIR = path.join(REPO_ROOT, "bench/obench-adapter")

const DEFAULT_TASKS = [
  "add-feature",
  "build-a-cli",
  "fix-failing-test",
  "make-ci-green",
  "make-it-run",
  "misleading-error",
  "taskflow",
  "webcore",
]

interface ObenchRow {
  run_id: string
  task: string
  success: boolean
  score?: number
  tokens?: number | null
  turns?: number | null
  error?: string | null
}

interface ObenchArgs {
  model: string
  tasks: string[]
  trials: number
  timeout: number
  maxIterations: number
  dryRun: boolean
  allowSystemPrompt: boolean
  allowDirty: boolean
  timeBudgetMin: number
}

function parseArgs(argv: string[]): ObenchArgs {
  const args: ObenchArgs = {
    model: process.env.OBENCH_MODEL ?? "qwen3.8-max",
    tasks: DEFAULT_TASKS,
    trials: 1,
    // Agent wall-clock cap per task. 600s starved webcore (a 7-part framework
    // build needs ~10-25 min) and made every suite cap at 7/8 — the optimizer
    // kept proposing prompt fixes for what was purely a time budget problem.
    timeout: 1800,
    maxIterations: 10,
    dryRun: false,
    allowSystemPrompt: false,
    allowDirty: false,
    timeBudgetMin: 0,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--model") args.model = argv[++i]
    else if (a === "--tasks") args.tasks = argv[++i].split(",").map((t) => t.trim()).filter(Boolean)
    else if (a === "--trials") args.trials = Number(argv[++i])
    else if (a === "--timeout") args.timeout = Number(argv[++i])
    else if (a === "--max-iterations") args.maxIterations = Number(argv[++i])
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--allow-system-prompt") args.allowSystemPrompt = true
    else if (a === "--allow-dirty") args.allowDirty = true
    else if (a === "--time-budget-min") args.timeBudgetMin = Number(argv[++i])
    else if (a === "--optimizer-provider") process.env.OPTIMIZER_PROVIDER = argv[++i]
    else if (a === "--optimizer-model") process.env.OPTIMIZER_MODEL = argv[++i]
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run bench:optimize:obench -- --model <canonical|provider/model>\n" +
          "  [--optimizer-provider <id> --optimizer-model <id>] [--tasks a,b,c]\n" +
          "  [--trials N] [--timeout S] [--max-iterations N] [--dry-run]\n" +
          "  [--allow-system-prompt] [--allow-dirty] [--time-budget-min N]",
      )
      process.exit(0)
    }
  }
  return args
}

// Run one OpenBench measurement: fresh results file, parse rows, build the
// failure summary from per-cell transcripts (full adapter output).
function makeMeasure(args: ObenchArgs) {
  return async (onProgress: (m: string) => void): Promise<OptimizerScore> => {
    await fs.mkdir(RESULTS_DIR, { recursive: true })
    const stamp = Date.now()
    const resultsPath = path.join(RESULTS_DIR, `obench-${stamp}.jsonl`)
    const transcriptsDir = path.join(RESULTS_DIR, "obench-transcripts")

    const cliArgs = [
      "run",
      "--task", args.tasks.join(","),
      "--harness", "codezal",
      "--model", args.model,
      "--trials", String(args.trials),
      "--timeout", String(args.timeout),
      "--adapters-dir", ADAPTERS_DIR,
      "--results-path", resultsPath,
      "--transcripts-dir", transcriptsDir,
    ]

    const code = await new Promise<number>((resolve) => {
      const child = spawn(OBENCH_BIN, cliArgs, {
        cwd: OBENCH_DIR,
        env: {
          ...process.env,
          // Checkers shell out to `python3`; the venv's 3.12 must win over
          // the system 3.9 (taskflow's checker uses asyncio.TaskGroup).
          PATH: `${path.join(OBENCH_DIR, ".venv/bin")}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let buf = ""
      const onData = (chunk: Buffer) => {
        buf += chunk.toString()
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) if (line.trim()) onProgress(`[obench] ${line.trim()}`)
      }
      child.stdout.on("data", onData)
      child.stderr.on("data", onData)
      child.on("close", (c) => resolve(c ?? 1))
    })
    if (code !== 0) throw new Error(`obench run exited ${code}`)

    const raw = await fs.readFile(resultsPath, "utf8")
    const rows = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ObenchRow)
    if (rows.length === 0) throw new Error("obench produced no result rows")

    let passed = 0
    let tokens = 0
    let tokensKnown = true
    const failures: string[] = []
    for (const row of rows) {
      const score = typeof row.score === "number" ? row.score : row.success ? 1 : 0
      passed += score
      if (typeof row.tokens === "number") tokens += row.tokens
      else tokensKnown = false
      if (score < 1) {
        const transcript = await readTranscript(transcriptsDir, resultsPath, row.run_id)
        failures.push(
          `### ${row.task} (${row.run_id}) — score ${score}\n` +
            `error: ${row.error ?? "(none — checker decided)"}\n` +
            (transcript ? `transcript tail:\n${transcript.slice(-2000)}` : "(no transcript)"),
        )
      }
    }

    return {
      passRate: passed / rows.length,
      passed,
      total: rows.length,
      tokens: tokensKnown ? tokens : null,
      failureSummary: failures.length === 0 ? "All tasks passed." : failures.join("\n\n"),
    }
  }
}

// Transcripts land at <transcriptsDir>/<results-file-stem>/<run_id with :→_>.txt
async function readTranscript(dir: string, resultsPath: string, runId: string): Promise<string | null> {
  const stem = path.basename(resultsPath).replace(/\.jsonl$/, "")
  const file = path.join(dir, stem, `${runId.replace(/:/g, "_")}.txt`)
  return fs.readFile(file, "utf8").catch(() => null)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const stat = await fs.stat(OBENCH_BIN).catch(() => null)
  if (!stat) {
    throw new Error(
      `OpenBench not set up at ${OBENCH_DIR}.\n` +
        "Expected: clone of minghinmatthewlam/openbench with `.venv` (uv venv --python 3.12) " +
        "and `uv pip install -e .` done. See bench/README.md.",
    )
  }

  const config = await loadConfig()
  await runOptimizeLoop({
    config,
    suiteName: "openbench",
    taskCount: args.tasks.length * args.trials,
    maxIterations: args.maxIterations,
    dryRun: args.dryRun,
    allowSystemPrompt: args.allowSystemPrompt,
    allowDirty: args.allowDirty,
    timeBudgetMin: args.timeBudgetMin,
    measure: makeMeasure(args),
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
