// Benchmark runner — executes the task suite headlessly and scores the run.
//
// Usage:
//   npm run bench -- --provider <id> --model <id> [--task <id>]... [--repeat N]
//                    [--quick] [--max-steps N] [--out <path>]
//   npm run bench -- --list     # providers with credentials (keychain or env)
//
// Provider/model come from the app catalog; the API key is read from the OS
// keychain (as stored by the desktop app) or env vars. BENCH_PROVIDER +
// BENCH_MODEL remain as env equivalents. Results go to bench/results/.
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runAgent, type TranscriptEntry } from "./runtime/agent"
import { benchModelRef, listRegisteredProviders, resolveModel } from "./runtime/provider"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TASKS_DIR = path.join(REPO_ROOT, "bench/tasks")
const RESULTS_DIR = path.join(REPO_ROOT, "bench/results")

interface VerifyRule {
  type: "commandSucceeds" | "fileContains" | "fileNotContains"
  command?: string
  path?: string
  pattern?: string
}

export interface BenchTask {
  id: string
  prompt: string
  verify: VerifyRule[]
  maxSteps?: number
  difficulty?: "easy" | "hard"
}

export interface TaskRunResult {
  taskId: string
  run: number
  passed: boolean
  verifyFailures: string[]
  steps: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  error?: string
  transcript: TranscriptEntry[]
}

export interface SuiteResult {
  model: string
  startedAt: string
  passRate: number
  passed: number
  total: number
  totalInputTokens: number
  totalOutputTokens: number
  totalDurationMs: number
  runs: TaskRunResult[]
}

export interface BenchConfig {
  maxSteps: number
  repeat: number
  quickTasks: string[]
  whitelist: string[]
  allowSystemPromptEdit: boolean
}

export async function loadConfig(): Promise<BenchConfig> {
  const raw = await fs.readFile(path.join(REPO_ROOT, "bench/config.json"), "utf8")
  return JSON.parse(raw) as BenchConfig
}

export async function loadTasks(): Promise<BenchTask[]> {
  const dirs = (await fs.readdir(TASKS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const tasks: BenchTask[] = []
  for (const dir of dirs) {
    const raw = await fs.readFile(path.join(TASKS_DIR, dir, "task.json"), "utf8")
    tasks.push(JSON.parse(raw) as BenchTask)
  }
  return tasks
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}

function runCommand(
  cwd: string,
  command: string,
  timeoutMs = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const isWin = process.platform === "win32"
  const [shell, args] = isWin ? ["cmd.exe", ["/c", command]] : ["bash", ["-c", command]]
  return new Promise((resolve) => {
    execFile(shell, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0
      resolve({ code, stdout, stderr })
    })
  })
}

async function verifyTask(task: BenchTask, workspace: string): Promise<string[]> {
  const failures: string[] = []
  // The verify script lives next to task.json — outside the fixture — so the
  // agent never sees it during the run. Copied in only for verification.
  const verifySrc = path.join(TASKS_DIR, task.id, "verify.js")
  const verifyDst = path.join(workspace, ".bench-verify.js")
  try {
    await fs.copyFile(verifySrc, verifyDst)
  } catch {
    // No verify.js — rules below must cover everything.
  }

  for (const rule of task.verify) {
    if (rule.type === "commandSucceeds" && rule.command) {
      const { code, stderr } = await runCommand(workspace, rule.command)
      if (code !== 0) {
        failures.push(`command failed (${rule.command}): exit ${code} ${stderr.slice(0, 500)}`)
      }
    } else if (rule.type === "fileContains" && rule.path && rule.pattern) {
      const content = await fs.readFile(path.join(workspace, rule.path), "utf8").catch(() => "")
      if (!new RegExp(rule.pattern).test(content)) {
        failures.push(`${rule.path} does not match /${rule.pattern}/`)
      }
    } else if (rule.type === "fileNotContains" && rule.path && rule.pattern) {
      const content = await fs.readFile(path.join(workspace, rule.path), "utf8").catch(() => "")
      if (new RegExp(rule.pattern).test(content)) {
        failures.push(`${rule.path} unexpectedly matches /${rule.pattern}/`)
      }
    }
  }
  await fs.rm(verifyDst, { force: true })
  return failures
}

export async function runTaskOnce(
  task: BenchTask,
  run: number,
  opts: { maxSteps: number; model: ReturnType<typeof benchModelRef> },
): Promise<TaskRunResult> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `codezal-bench-${task.id}-`))
  const started = Date.now()
  try {
    await copyDir(path.join(TASKS_DIR, task.id, "fixture"), workspace)
    const agent = await runAgent({
      workspace,
      prompt: task.prompt,
      modelRef: opts.model,
      maxSteps: task.maxSteps ?? opts.maxSteps,
    })
    const verifyFailures = agent.error ? [agent.error] : await verifyTask(task, workspace)
    return {
      taskId: task.id,
      run,
      passed: verifyFailures.length === 0,
      verifyFailures,
      steps: agent.steps,
      toolCalls: agent.toolCalls,
      inputTokens: agent.inputTokens,
      outputTokens: agent.outputTokens,
      durationMs: Date.now() - started,
      error: agent.error,
      transcript: agent.transcript,
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
}

export async function runSuite(opts: {
  tasks: BenchTask[]
  repeat: number
  maxSteps: number
  onProgress?: (msg: string) => void
}): Promise<SuiteResult> {
  const model = benchModelRef()
  const log = opts.onProgress ?? (() => {})
  // Preflight: resolve provider + credentials once, before any task runs.
  // Fails fast on an unknown provider / missing key, and surfaces the macOS
  // keychain access prompt up front (click "Always Allow") instead of letting
  // it time out the first task.
  await resolveModel(model)
  const runs: TaskRunResult[] = []

  for (const task of opts.tasks) {
    for (let r = 1; r <= opts.repeat; r++) {
      log(`[bench] ${task.id} (run ${r}/${opts.repeat}) ...`)
      const result = await runTaskOnce(task, r, { maxSteps: opts.maxSteps, model })
      runs.push(result)
      log(
        `[bench] ${task.id} run ${r}: ${result.passed ? "PASS" : "FAIL"} ` +
          `(${result.steps} steps, ${result.inputTokens + result.outputTokens} tokens, ${(result.durationMs / 1000).toFixed(0)}s)`,
      )
    }
  }

  const passed = runs.filter((r) => r.passed).length
  return {
    model: `${model.provider}/${model.model}`,
    startedAt: new Date().toISOString(),
    passRate: runs.length === 0 ? 0 : passed / runs.length,
    passed,
    total: runs.length,
    totalInputTokens: runs.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: runs.reduce((s, r) => s + r.outputTokens, 0),
    totalDurationMs: runs.reduce((s, r) => s + r.durationMs, 0),
    runs,
  }
}

export async function saveResult(result: SuiteResult, outPath?: string): Promise<string> {
  await fs.mkdir(RESULTS_DIR, { recursive: true })
  const file =
    outPath ?? path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  await fs.writeFile(file, JSON.stringify(result, null, 2), "utf8")
  return file
}

function parseArgs(argv: string[]): {
  taskIds: string[]
  repeat?: number
  quick: boolean
  hard: boolean
  maxSteps?: number
  out?: string
  provider?: string
  model?: string
  list: boolean
  help: boolean
} {
  const taskIds: string[] = []
  let repeat: number | undefined
  let quick = false
  let hard = false
  let maxSteps: number | undefined
  let out: string | undefined
  let provider: string | undefined
  let model: string | undefined
  let list = false
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--task") taskIds.push(argv[++i])
    else if (a === "--repeat") repeat = Number(argv[++i])
    else if (a === "--quick") quick = true
    else if (a === "--hard") hard = true
    else if (a === "--max-steps") maxSteps = Number(argv[++i])
    else if (a === "--out") out = argv[++i]
    else if (a === "--provider") provider = argv[++i]
    else if (a === "--model") model = argv[++i]
    else if (a === "--list") list = true
    else if (a === "--help" || a === "-h") help = true
  }
  return { taskIds, repeat, quick, hard, maxSteps, out, provider, model, list, help }
}

async function printRegistered(): Promise<void> {
  const providers = await listRegisteredProviders()
  if (providers.length === 0) {
    console.log(
      "No registered providers found. Add an API key in the Codezal app " +
        "(stored in the OS keychain) or set a provider env var.",
    )
    return
  }
  console.log("Registered providers (credentials available):\n")
  for (const p of providers) {
    console.log(`  ${p.id} — ${p.name} [${p.auth}: ${p.authDetail}]`)
    if (p.models.length > 0) console.log(`    models: ${p.models.join(", ")}${p.models.length === 6 ? ", …" : ""}`)
  }
  console.log("\nRun: npm run bench -- --provider <id> --model <model-id> [--quick]")
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: npm run bench -- --provider <id> --model <id> [--task <id>]... [--repeat N]\n" +
        "  [--quick] [--hard] [--max-steps N] [--out <path>]\n" +
        "       npm run bench -- --list\n" +
        "Env equivalents: BENCH_PROVIDER, BENCH_MODEL, BENCH_API_KEY, BENCH_BASE_URL.",
    )
    return
  }
  if (args.list) {
    await printRegistered()
    return
  }
  if (args.provider || args.model) {
    if (!args.provider || !args.model) {
      console.error("--provider and --model must be given together.")
      process.exit(1)
    }
    process.env.BENCH_PROVIDER = args.provider
    process.env.BENCH_MODEL = args.model
  }
  const config = await loadConfig()
  let tasks = await loadTasks()
  if (args.taskIds.length > 0) {
    tasks = tasks.filter((t) => args.taskIds.includes(t.id))
    if (tasks.length === 0) {
      console.error(`No matching tasks. Available: ${(await loadTasks()).map((t) => t.id).join(", ")}`)
      process.exit(1)
    }
  } else if (args.hard) {
    tasks = tasks.filter((t) => t.difficulty === "hard")
  } else if (args.quick) {
    tasks = tasks.filter((t) => config.quickTasks.includes(t.id))
  }

  const result = await runSuite({
    tasks,
    repeat: args.repeat ?? config.repeat,
    maxSteps: args.maxSteps ?? config.maxSteps,
    onProgress: (m) => console.log(m),
  })
  const file = await saveResult(result, args.out)
  console.log(
    `\n=== ${result.model} — pass rate ${(result.passRate * 100).toFixed(1)}% ` +
      `(${result.passed}/${result.total}), tokens ${result.totalInputTokens + result.totalOutputTokens}, ` +
      `${(result.totalDurationMs / 1000).toFixed(0)}s ===\nresults: ${file}`,
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
