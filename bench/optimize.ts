// RSI loop — an optimizer model iteratively improves the shared harness
// prompt files; every candidate is gated by the deterministic benchmark.
//
// Flow per iteration:
//   1. Optimizer receives current scores, failing-task details, and the
//      whitelist files; it returns ONE small change as structured JSON edits.
//   2. Edits are applied; a whitelist check guarantees nothing outside the
//      allowed optimization surface changed.
//   3. The benchmark re-runs. Score improved → git commit. Not improved →
//      full revert of the whitelist files.
//
// Usage:
//   npm run bench:optimize -- --provider <id> --model <id>
//     [--optimizer-provider <id> --optimizer-model <id>] [--max-iterations N]
//     [--quick] [--dry-run] [--allow-system-prompt] [--allow-dirty]
//     [--time-budget-min N]
//
// Provider ids + credentials resolve like `npm run bench` (see --list there).
// Env equivalents: BENCH_PROVIDER/BENCH_MODEL (agent under test),
//      OPTIMIZER_PROVIDER/OPTIMIZER_MODEL (defaults to the BENCH_* pair).
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { generateText } from "ai"
import { loadConfig, loadTasks, runSuite, saveResult, type BenchConfig, type SuiteResult } from "./run"
import { optimizerModelRef, resolveModel } from "./runtime/provider"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const RESULTS_DIR = path.join(REPO_ROOT, "bench/results")
const SYSTEM_PROMPT_WHITELIST = "src/lib/prompts/"
const COMMIT_TRAILER = "Co-Authored-By: Codezal <[EMAIL_2]>"

const execFileP = promisify(execFile)

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 })
  return stdout
}

interface OptimizerEdit {
  path: string
  old_string?: string
  new_string?: string
  content?: string
}

interface OptimizerProposal {
  hypothesis: string
  edits: OptimizerEdit[]
}

function whitelistPrefixes(config: BenchConfig, allowSystemPrompt: boolean): string[] {
  const prefixes = [...config.whitelist]
  if (allowSystemPrompt || config.allowSystemPromptEdit) prefixes.push(SYSTEM_PROMPT_WHITELIST)
  return prefixes
}

function isAllowed(rel: string, prefixes: string[]): boolean {
  const norm = rel.split(path.sep).join("/")
  return prefixes.some((p) => norm === p || norm.startsWith(p))
}

// Snapshot every file under the whitelist prefixes so a rejected iteration
// can be reverted byte-for-byte (including deleting newly created files).
async function snapshotWhitelist(prefixes: string[]): Promise<Map<string, string | null>> {
  const snap = new Map<string, string | null>()
  for (const prefix of prefixes) {
    const abs = path.join(REPO_ROOT, prefix)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) continue
    if (stat.isFile()) {
      snap.set(prefix, await fs.readFile(abs, "utf8"))
      continue
    }
    for (const file of await walk(abs)) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/")
      snap.set(rel, await fs.readFile(file, "utf8"))
    }
  }
  return snap
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(abs)))
    else out.push(abs)
  }
  return out
}

async function restoreSnapshot(snap: Map<string, string | null>, dirPrefixes: string[]): Promise<void> {
  // Remove files created during the iteration — but ONLY inside whitelisted
  // directories (never derived parent dirs, which may hold unrelated files).
  for (const prefix of dirPrefixes) {
    const abs = path.join(REPO_ROOT, prefix)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isDirectory()) continue
    for (const file of await walk(abs)) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/")
      if (!snap.has(rel)) await fs.rm(file, { force: true })
    }
  }
  for (const [rel, content] of snap) {
    if (content === null) continue
    const abs = path.join(REPO_ROOT, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, "utf8")
  }
}

async function applyProposal(proposal: OptimizerProposal, prefixes: string[]): Promise<void> {
  for (const edit of proposal.edits) {
    if (!isAllowed(edit.path, prefixes)) {
      throw new Error(`Edit path outside whitelist: ${edit.path}`)
    }
  }
  for (const edit of proposal.edits) {
    const abs = path.join(REPO_ROOT, edit.path)
    if (typeof edit.content === "string") {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, edit.content, "utf8")
      continue
    }
    if (typeof edit.old_string !== "string" || typeof edit.new_string !== "string") {
      throw new Error(`Edit for ${edit.path} needs either content or old_string+new_string`)
    }
    const current = await fs.readFile(abs, "utf8")
    if (!current.includes(edit.old_string)) {
      throw new Error(`old_string not found in ${edit.path}`)
    }
    await fs.writeFile(abs, current.replace(edit.old_string, edit.new_string), "utf8")
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("Optimizer returned no JSON object")
  return JSON.parse(candidate.slice(start, end + 1))
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

async function proposeOnce(opts: {
  config: BenchConfig
  prefixes: string[]
  best: SuiteResult
  last: SuiteResult | null
  iteration: number
  priorHypotheses: string[]
}): Promise<OptimizerProposal> {
  const files: string[] = []
  for (const [rel, content] of await snapshotWhitelist(opts.prefixes)) {
    if (content !== null) files.push(`--- ${rel} ---\n${content}`)
  }

  const prompt = `You are optimizing the agent harness of Codezal (an AI coding assistant). You do NOT retrain any model — you improve the harness text the model reads at runtime: tool descriptions and (if allowed) the base system prompt.

Current best benchmark score: ${(opts.best.passRate * 100).toFixed(1)}% (${opts.best.passed}/${opts.best.total}).
${opts.last ? `Last iteration score: ${(opts.last.passRate * 100).toFixed(1)}% (${opts.last.passed}/${opts.last.total}).` : "This is the first iteration (baseline just measured)."}

Failing tasks in the latest run:
${summarizeFailures(opts.last ?? opts.best, 2000)}

Previously tried hypotheses (do not repeat them):
${opts.priorHypotheses.length === 0 ? "(none yet)" : opts.priorHypotheses.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Files you may edit (whitelist — nothing else may change):
${files.join("\n\n")}

Instructions:
- Form ONE small, concrete hypothesis about why tasks fail and how a harness-text change would fix it GENERALLY (no task-specific hacks, no mentioning benchmark tasks by name — that would be overfitting).
- Prefer editing one file per iteration. Small diffs beat rewrites.
- Tool descriptions must stay accurate: the tools are read_file, write_file, edit_file, bash, grep, glob, list_dir with the semantics the current text describes.
- Reply with ONLY a JSON object (no prose), schema:
  {"hypothesis": "one sentence", "edits": [{"path": "<whitelisted path>", "old_string": "...", "new_string": "..."}]}
  Use "content" instead of old_string/new_string only for a deliberate full-file rewrite of a small file.`

  const ref = optimizerModelRef()
  const result = await generateText({ model: await resolveModel(ref), prompt })
  const parsed = extractJson(result.text) as OptimizerProposal
  if (!parsed || typeof parsed.hypothesis !== "string" || !Array.isArray(parsed.edits) || parsed.edits.length === 0) {
    throw new Error("Optimizer proposal is missing hypothesis or edits")
  }
  return parsed
}

function isBetter(candidate: SuiteResult, best: SuiteResult): boolean {
  if (candidate.passRate > best.passRate) return true
  if (candidate.passRate === best.passRate && candidate.passRate > 0) {
    const candTokens = candidate.totalInputTokens + candidate.totalOutputTokens
    const bestTokens = best.totalInputTokens + best.totalOutputTokens
    // Require a meaningful (>3%) token reduction to count as an improvement —
    // avoids committing noise-level wins.
    return candTokens < bestTokens * 0.97
  }
  return false
}

async function appendLog(entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(RESULTS_DIR, { recursive: true })
  await fs.appendFile(
    path.join(RESULTS_DIR, "optimize-log.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
    "utf8",
  )
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()
  const prefixes = whitelistPrefixes(config, args.allowSystemPrompt)
  const dirPrefixes = prefixes.filter((p) => p.endsWith("/"))

  // Untracked (??) entries are ignored in both guards: they don't affect the
  // whitelist snapshot/revert, and `git add -- <prefixes>` never stages them.
  const trackedStatus = async (): Promise<string[]> =>
    (await git("status", "--porcelain"))
      .trim()
      .split("\n")
      .filter((l) => l && !l.startsWith("??"))
  const dirty = await trackedStatus()
  if (dirty.length > 0 && !args.allowDirty) {
    throw new Error("Working tree is not clean — commit or stash first (or pass --allow-dirty).")
  }

  const allTasks = await loadTasks()
  const suiteName = args.hard ? "hard" : args.quick ? "quick" : "full"
  const tasks = args.hard
    ? allTasks.filter((t) => t.difficulty === "hard")
    : args.quick
      ? allTasks.filter((t) => config.quickTasks.includes(t.id))
      : allTasks
  const suiteOpts = { tasks, repeat: config.repeat, maxSteps: config.maxSteps }
  const log = (m: string) => console.log(`[optimize] ${m}`)

  log(`measuring baseline on ${tasks.length} task(s) (${suiteName} suite)...`)
  let best = await runSuite({ ...suiteOpts, onProgress: log })
  await saveResult(best)
  await appendLog({ type: "baseline", passRate: best.passRate, passed: best.passed, total: best.total })
  log(`baseline: ${(best.passRate * 100).toFixed(1)}% (${best.passed}/${best.total})`)

  const startedAt = Date.now()
  const priorHypotheses: string[] = []
  let last: SuiteResult | null = null
  const iterations = args.dryRun ? 1 : args.maxIterations

  for (let i = 1; i <= iterations; i++) {
    if (args.timeBudgetMin > 0 && Date.now() - startedAt > args.timeBudgetMin * 60_000) {
      log(`time budget reached (${args.timeBudgetMin} min) — stopping`)
      break
    }
    log(`--- iteration ${i}/${iterations} ---`)
    const snapshot = await snapshotWhitelist(prefixes)

    let proposal: OptimizerProposal
    try {
      proposal = await proposeOnce({ config, prefixes, best, last, iteration: i, priorHypotheses })
    } catch (e) {
      log(`optimizer proposal failed: ${e instanceof Error ? e.message : e}`)
      await appendLog({ type: "iteration", iteration: i, outcome: "proposal-error", error: String(e) })
      continue
    }
    priorHypotheses.push(proposal.hypothesis)
    log(`hypothesis: ${proposal.hypothesis}`)

    try {
      await applyProposal(proposal, prefixes)
    } catch (e) {
      log(`invalid proposal (${e instanceof Error ? e.message : e}) — reverting`)
      await restoreSnapshot(snapshot, dirPrefixes)
      await appendLog({ type: "iteration", iteration: i, outcome: "invalid-edit", hypothesis: proposal.hypothesis })
      continue
    }

    // Post-apply guard: nothing outside the whitelist may have changed.
    const offenders = (await trackedStatus()).filter((line) => !isAllowed(line.slice(3).trim(), prefixes))
    if (offenders.length > 0) {
      log(`whitelist violation (${offenders.join(", ")}) — reverting`)
      await restoreSnapshot(snapshot, dirPrefixes)
      await appendLog({ type: "iteration", iteration: i, outcome: "whitelist-violation", offenders })
      continue
    }

    const candidate = await runSuite({ ...suiteOpts, onProgress: log })
    await saveResult(candidate)
    last = candidate
    log(
      `candidate: ${(candidate.passRate * 100).toFixed(1)}% (${candidate.passed}/${candidate.total}) ` +
        `vs best ${(best.passRate * 100).toFixed(1)}%`,
    )

    if (!args.dryRun && isBetter(candidate, best)) {
      best = candidate
      await git("add", "--", ...prefixes)
      const message = `bench: ${proposal.hypothesis.replace(/[\r\n]+/g, " ").slice(0, 120)}\n\n${COMMIT_TRAILER}\n`
      await git("commit", "--no-verify", "-m", message, "--", ...prefixes)
      log(`ACCEPTED — committed`)
      await appendLog({ type: "iteration", iteration: i, outcome: "accepted", hypothesis: proposal.hypothesis, passRate: candidate.passRate })
    } else {
      await restoreSnapshot(snapshot, dirPrefixes)
      log(args.dryRun ? "dry-run — reverted without committing" : "REJECTED — reverted")
      await appendLog({ type: "iteration", iteration: i, outcome: args.dryRun ? "dry-run" : "rejected", hypothesis: proposal.hypothesis, passRate: candidate.passRate })
    }
  }

  log(`done. best: ${(best.passRate * 100).toFixed(1)}% (${best.passed}/${best.total})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
