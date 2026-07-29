# bench — Agent Harness Benchmark & RSI Optimizer

Benchmarks the Codezal agent harness against a Terminal-Bench-style task
suite, and provides an **RSI (Recursive Self Improvement) loop**
(`optimize.ts`): an optimizer model proposes small harness edits, each
candidate is re-benchmarked, and a change is committed only if the score
improves (hill climbing).

No custom provider setup is needed — benchmarks run against the **providers
already connected in the app** (Kimi For Coding, DeepSeek, Alibaba, …).

## Prerequisites

Everything runs from the repo root with the app's own dependencies:

```bash
npm install
```

### Credentials

Resolved automatically, in this order:

1. `BENCH_API_KEY` (explicit override for the subject model)
2. The provider's env var from the models.dev catalog
   (`MOONSHOTAI_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`,
   `ANTHROPIC_API_KEY`, …)
3. The **app keychain** — the same OS keychain the desktop app writes to
   (`service: codezal`, account `apiKey.<providerId>`). macOS Keychain and
   Windows Credential Manager are both supported.

List catalog providers and which ones have a key in the keychain:

```bash
npm run bench -- --list
```

If a provider you connected in the app is missing, re-save that connection in
the app once (writes the key to the keychain), or set its env var.

### Catalog source

Provider/model ids come from the **app's live-cached models.dev catalog**
(`settings.json → providerCatalog.data`) when present — this includes newer
entries like `alibaba-token-plan` (`qwen3.8-max-preview`) and
`kimi-for-coding` `k3`. The bundled `src/lib/catalog-snapshot.json` is only a
fallback (e.g. on machines where the app never ran). What you see in the app's
model picker is what the bench can run.

## Running a benchmark (`bench/run.ts`)

```bash
# Pick any catalog provider + model (must be given together)
npm run bench -- --provider kimi-for-coding --model k2p6
npm run bench -- --provider deepseek --model deepseek-v4-flash
npm run bench -- --provider alibaba --model qwen3-max

# Quick suite (4 tasks from config.json "quickTasks") for fast iteration
npm run bench -- --provider kimi-for-coding --model k2p6 --quick

# A single task / variance measurement
npm run bench -- --provider kimi-for-coding --model k2p6 --task fix-subtract-bug --repeat 3
```

Provider id aliases: `kimi` → `kimi-for-coding`, `moonshot` → `moonshotai`.

### Flags

| Flag | Default | Description |
|---|---|---|
| `--provider <id>` | env `BENCH_PROVIDER` | Provider id from the models.dev catalog |
| `--model <id>` | env `BENCH_MODEL` | Model id within that provider (required with `--provider`) |
| `--quick` | off | Run only the `quickTasks` subset from `bench/config.json` |
| `--hard` | off | Run only tasks with `"difficulty": "hard"` |
| `--task <id>` | all | Run one task; repeatable |
| `--repeat <n>` | 1 | Runs per task |
| `--max-steps <n>` | 15 | Agent step cap (`bench/config.json`) |
| `--out <path>` | `bench/results/<timestamp>.json` | Result file path |
| `--list` | — | List catalog providers (+ keychain status) and exit |

Output: a JSON file under `bench/results/` with per-task pass/fail, steps,
token usage, duration, and a summary (pass rate, totals).

Credentials are preflighted once before the first task. On macOS the first
run may show a keychain access prompt for the app-stored item — click
**Always Allow**; every later read (in-process cached) is instant.

## RSI optimize loop (`bench/optimize.ts`)

The optimizer model edits only a **whitelist** of harness files
(`bench/config.json` → `whitelist`: `src/lib/tools/prompts/`,
`bench/config.json`; the scoring gate and verifier are never editable). Each
iteration:

1. Optimizer proposes ONE small change as structured JSON edits
   (`{hypothesis, edits[]}`) with a stated hypothesis.
2. Edits are applied; a `git status --porcelain` check reverts anything
   touching files outside the whitelist.
3. The benchmark runs on the task set (`--quick` subset or `--full`).
4. **Accepted** if the pass rate beats the champion — or ties it with a >3%
   token reduction (the cost axis) → committed to git
   (`bench: <hypothesis>`); otherwise fully reverted.

```bash
# Baseline + up to 10 iterations, same model as subject and optimizer
npm run bench:optimize -- --provider alibaba-token-plan --model qwen3.8-max-preview

# Recommended: Qwen3.8 Max Preview as subject, Kimi K3 as the optimizer
npm run bench:optimize -- \
  --provider alibaba-token-plan --model qwen3.8-max-preview \
  --optimizer-provider kimi-for-coding --optimizer-model k3 \
  --hard --max-iterations 20 --time-budget-min 180

# One trial iteration, never committed
npm run bench:optimize -- --provider alibaba-token-plan --model qwen3.8-max-preview --dry-run
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--provider` / `--model` | env `BENCH_PROVIDER` / `BENCH_MODEL` | **Subject** model being benchmarked |
| `--optimizer-provider` / `--optimizer-model` | same as subject | Model that proposes harness changes |
| `--max-iterations <n>` | 10 | Optimization rounds |
| `--quick` / `--full` / `--hard` | `--quick` | Eval task set: `quickTasks` subset, all tasks, or hard tasks only |
| `--dry-run` | off | Single iteration, reverted without committing |
| `--allow-system-prompt` | off | Also whitelist `src/lib/prompts/` |
| `--allow-dirty` | off | Run with a dirty working tree (default: refuse) |
| `--time-budget-min <n>` | 0 (off) | Stop after N minutes |

The loop commits accepted changes directly to the current branch — run it on
`main` per project convention, and use `--time-budget-min` for overnight runs.

State / logs:

- `bench/results/optimize-log.jsonl` — one JSON line per event
  (`baseline`, `iteration` with outcome `accepted` / `rejected` /
  `dry-run` / `whitelist-violation`).
- Accepted iterations become regular git commits; the full history of what
  was kept is `git log`.

## Configuration (`bench/config.json`)

```json
{
  "maxSteps": 15,
  "repeat": 1,
  "quickTasks": ["fix-subtract-bug", "fix-off-by-one", "fix-json-config", "fix-regex"],
  "whitelist": ["src/lib/tools/prompts/", "bench/config.json"],
  "allowSystemPromptEdit": false
}
```

- `quickTasks` — task ids used by `--quick` (and by the optimizer by default).
- `whitelist` — file/dir prefixes the optimizer is allowed to touch.

## Task suite (`bench/tasks/`)

Each task is a directory:

- `task.json` — `{ id, prompt, verify: [...], maxSteps?, difficulty? }` where
  verify rules are `commandSucceeds` / `fileContains` / `fileNotContains`
- `fixture/` — files copied into the sandbox before the run
- `verify.js` (optional) — copied into the sandbox only at verification time
  (the agent never sees it), for hidden checks: extra edge-case asserts,
  sha256 locks on files the agent must not touch, golden-output comparison

Easy tasks: `add-cli-flag`, `add-test`, `extract-helper`, `fix-async-await`,
`fix-default-port`, `fix-json-config`, `fix-off-by-one`, `fix-regex`,
`fix-subtract-bug`, `rename-function`.

### Hard tasks (`--hard`)

Once a model/harness scores ~100% on the easy suite, pass-rate signal is gone
— the hard suite re-opens headroom. Each task targets a different harness
weakness:

| Task | What it punishes |
|---|---|
| `hidden-edge-cases` | Lazy fixes that pass visible tests but break the stated contract (hidden asserts in verify.js) |
| `wrong-file-trap` | Fixing the suspicious-looking file instead of the root cause (decoy file is guarded) |
| `broken-test-runner` | Not reading actual error output — the test command itself is misconfigured, then the code is also buggy |
| `cross-file-rename` | Incomplete multi-file refactors (5 files, old name must vanish everywhere) |
| `dont-touch-tests` | "Making tests pass" by editing the tests (sha256-locked spec file + hidden asserts) |
| `needle-in-haystack` | Read-everything exploration — one bug hidden among 18 modules; token discipline matters |
| `shared-state-flake` | Deleting the cache to fix staleness (hidden asserts prove caching must keep working) |
| `exact-output-cli` | Eyeballing instead of diffing — stdout must match a golden file byte-for-byte (golden file is hash-locked; reading it from the program is forbidden) |

`bench/tasks/` is **not** in the optimizer whitelist, so the RSI loop cannot
game the suite by editing tasks.

To add a task: create the directory with those three entries, then validate
mechanically (no model needed — pristine fixture must FAIL, the reference
solution must PASS):

```bash
bash bench/scripts/validate-tasks.sh
```

and smoke-test with a model:

```bash
npm run bench -- --provider kimi-for-coding --model k2p6 --task <id>
```

## Tips

- Use `--quick` while iterating on the harness; `--full` (or a plain `run`)
  for acceptance decisions.
- Prefer a model with strong reasoning as `--optimizer-model` — proposals are
  long-horizon, single-shot JSON edits.
- `--repeat 3` on a run gives a variance estimate before trusting a ±1-task
  pass-rate delta.
