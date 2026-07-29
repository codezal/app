// Shared RSI optimizer loop — backend-agnostic.
//
// The loop owns: whitelist snapshot/apply/revert, the optimizer-model
// proposal round-trip, score comparison, git accept commits, and logging.
// A "backend" only supplies `measure()` — run a benchmark over the current
// whitelist files and return a score + a failure summary for the optimizer.
// Two backends exist: the internal suite (optimize.ts) and OpenBench
// (optimize-obench.ts).
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { generateText } from "ai"
import type { BenchConfig } from "./run"
import { optimizerModelRef, resolveModel } from "./runtime/provider"

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const RESULTS_DIR = path.join(REPO_ROOT, "bench/results")
const SYSTEM_PROMPT_WHITELIST = "src/lib/prompts/"
const COMMIT_TRAILER = "Co-Authored-By: Codezal <[EMAIL_2]>"

const execFileP = promisify(execFile)

export async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 })
  return stdout
}

export interface OptimizerEdit {
  path: string
  old_string?: string
  new_string?: string
  content?: string
}

export interface OptimizerProposal {
  hypothesis: string
  edits: OptimizerEdit[]
}

// What one benchmark measurement returns. `tokens` may be null when the
// backend cannot attribute usage; then ties on passRate are not improvements.
export interface OptimizerScore {
  passRate: number
  passed: number
  total: number
  tokens: number | null
  failureSummary: string
}

export function whitelistPrefixes(config: BenchConfig, allowSystemPrompt: boolean): string[] {
  const prefixes = [...config.whitelist]
  if (allowSystemPrompt || config.allowSystemPromptEdit) prefixes.push(SYSTEM_PROMPT_WHITELIST)
  return prefixes
}

function isAllowed(rel: string, prefixes: string[]): boolean {
  const norm = rel.split(path.sep).join("/")
  return prefixes.some((p) => norm === p || norm.startsWith(p))
}

// Untracked (??) entries are ignored in both guards: they don't affect the
// whitelist snapshot/revert, and `git add -- <prefixes>` never stages them.
export async function trackedStatus(): Promise<string[]> {
  return (await git("status", "--porcelain"))
    .trim()
    .split("\n")
    .filter((l) => l && !l.startsWith("??"))
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

async function proposeOnce(opts: {
  prefixes: string[]
  best: OptimizerScore
  last: OptimizerScore | null
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
${opts.last ? opts.last.failureSummary : opts.best.failureSummary}

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
  const result = await generateText({
    model: await resolveModel(ref),
    prompt,
    // Catalogs of unknown models default to 4096 max output tokens, which
    // truncates large proposals mid-JSON. Give the optimizer real headroom.
    maxOutputTokens: 16384,
  })
  const parsed = extractJson(result.text) as OptimizerProposal
  if (!parsed || typeof parsed.hypothesis !== "string" || !Array.isArray(parsed.edits) || parsed.edits.length === 0) {
    throw new Error("Optimizer proposal is missing hypothesis or edits")
  }
  return parsed
}

function isBetter(candidate: OptimizerScore, best: OptimizerScore): boolean {
  if (candidate.passRate > best.passRate) return true
  if (candidate.passRate === best.passRate && candidate.passRate > 0) {
    if (candidate.tokens === null || best.tokens === null) return false
    // Require a meaningful (>3%) token reduction to count as an improvement —
    // avoids committing noise-level wins.
    return candidate.tokens < best.tokens * 0.97
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

export interface LoopOptions {
  config: BenchConfig
  suiteName: string
  taskCount: number
  maxIterations: number
  dryRun: boolean
  allowSystemPrompt: boolean
  allowDirty: boolean
  timeBudgetMin: number
  measure: (onProgress: (m: string) => void) => Promise<OptimizerScore>
}

export async function runOptimizeLoop(opts: LoopOptions): Promise<void> {
  const prefixes = whitelistPrefixes(opts.config, opts.allowSystemPrompt)
  const dirPrefixes = prefixes.filter((p) => p.endsWith("/"))
  const log = (m: string) => console.log(`[optimize] ${m}`)

  const dirty = await trackedStatus()
  if (dirty.length > 0 && !opts.allowDirty) {
    throw new Error("Working tree is not clean — commit or stash first (or pass --allow-dirty).")
  }
  // With --allow-dirty, pre-existing dirty files outside the whitelist are
  // tolerated — the violation guard below only flags files that BECAME dirty
  // during an iteration.
  const preDirty = new Set(dirty)

  log(`measuring baseline on ${opts.taskCount} task(s) (${opts.suiteName} suite)...`)
  let best = await opts.measure(log)
  await appendLog({ type: "baseline", suite: opts.suiteName, passRate: best.passRate, passed: best.passed, total: best.total })
  log(`baseline: ${(best.passRate * 100).toFixed(1)}% (${best.passed}/${best.total})`)

  const startedAt = Date.now()
  const priorHypotheses: string[] = []
  let last: OptimizerScore | null = null
  const iterations = opts.dryRun ? 1 : opts.maxIterations

  for (let i = 1; i <= iterations; i++) {
    if (opts.timeBudgetMin > 0 && Date.now() - startedAt > opts.timeBudgetMin * 60_000) {
      log(`time budget reached (${opts.timeBudgetMin} min) — stopping`)
      break
    }
    log(`--- iteration ${i}/${iterations} ---`)
    const snapshot = await snapshotWhitelist(prefixes)

    let proposal: OptimizerProposal
    try {
      proposal = await proposeOnce({ prefixes, best, last, priorHypotheses })
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
    const offenders = (await trackedStatus()).filter(
      (line) => !preDirty.has(line) && !isAllowed(line.slice(3).trim(), prefixes),
    )
    if (offenders.length > 0) {
      log(`whitelist violation (${offenders.join(", ")}) — reverting`)
      await restoreSnapshot(snapshot, dirPrefixes)
      await appendLog({ type: "iteration", iteration: i, outcome: "whitelist-violation", offenders })
      continue
    }

    const candidate = await opts.measure(log)
    last = candidate
    log(
      `candidate: ${(candidate.passRate * 100).toFixed(1)}% (${candidate.passed}/${candidate.total}) ` +
        `vs best ${(best.passRate * 100).toFixed(1)}%`,
    )

    if (!opts.dryRun && isBetter(candidate, best)) {
      best = candidate
      await git("add", "--", ...prefixes)
      const message = `bench: ${proposal.hypothesis.replace(/[\r\n]+/g, " ").slice(0, 120)}\n\n${COMMIT_TRAILER}\n`
      await git("commit", "--no-verify", "-m", message, "--", ...prefixes)
      log(`ACCEPTED — committed`)
      await appendLog({ type: "iteration", iteration: i, outcome: "accepted", hypothesis: proposal.hypothesis, passRate: candidate.passRate })
    } else {
      await restoreSnapshot(snapshot, dirPrefixes)
      log(opts.dryRun ? "dry-run — reverted without committing" : "REJECTED — reverted")
      await appendLog({ type: "iteration", iteration: i, outcome: opts.dryRun ? "dry-run" : "rejected", hypothesis: proposal.hypothesis, passRate: candidate.passRate })
    }
  }

  log(`done. best: ${(best.passRate * 100).toFixed(1)}% (${best.passed}/${best.total})`)
}
