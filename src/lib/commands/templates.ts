// Built-in prompt templates for /init and /review. These are sent verbatim to
// the model as the turn body (no UI text), so they are written in English per
// the project's on-disk language rule; the model replies in the user's
// language. Adapted from opencode's command templates, retargeted to Codezal:
// the instruction file is AGENTS.md (model-agnostic), with a tiny CLAUDE.md
// pointer for back-compat.

export const INIT_TEMPLATE = `Create or update \`AGENTS.md\` for this repository.

The goal is a compact instruction file that helps future agent sessions avoid
mistakes and ramp up quickly. Every line should answer: "Would an agent likely
miss this without help?" If not, leave it out.

\`AGENTS.md\` is the model-agnostic standard — Claude, Codex, OpenCode, and other
agents all read it. If a root \`CLAUDE.md\` does not already exist, also write a
minimal one that simply points at AGENTS.md:

\`\`\`
This project uses AGENTS.md. Please read AGENTS.md first.
\`\`\`

Do not duplicate the full instructions into CLAUDE.md — the pointer is enough.

User-provided focus or constraints (honor these):
$ARGUMENTS

## How to investigate

Read the highest-value sources first:
- \`README*\`, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task runner config
- existing instruction files (\`AGENTS.md\`, \`CLAUDE.md\`, \`.cursor/rules/\`, \`.cursorrules\`, \`.github/copilot-instructions.md\`)

If architecture is still unclear after reading config and docs, inspect a small
number of representative code files to find the real entrypoints, package
boundaries, and execution flow. Prefer files that explain how the system is
wired together over random leaf files.

Prefer executable sources of truth over prose. If docs conflict with config or
scripts, trust the executable source and only keep what you can verify.

## What to extract

Look for the highest-signal facts for an agent working in this repo:
- exact developer commands, especially non-obvious ones
- how to run a single test, a single package, or a focused verification step
- required command order when it matters, such as \`lint -> typecheck -> test\`
- monorepo or multi-package boundaries, ownership of major directories, and the real app/library entrypoints
- framework or toolchain quirks: generated code, migrations, codegen, build artifacts, special env loading, dev servers, infra deploy flow
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration test prerequisites, snapshot workflows, required services, flaky or expensive suites
- important constraints from existing instruction files worth preserving

Good \`AGENTS.md\` content is usually hard-earned context that took reading
multiple files to infer.

## Writing rules

Include only high-signal, repo-specific guidance such as:
- exact commands and shortcuts the agent would otherwise guess wrong
- architecture notes that are not obvious from filenames
- conventions that differ from language or framework defaults
- setup requirements, environment quirks, and operational gotchas

Exclude:
- generic software advice
- long tutorials or exhaustive file trees
- obvious language conventions
- speculative claims or anything you could not verify

When in doubt, omit. Prefer short sections and bullets. If the repo is simple,
keep the file simple.

If \`AGENTS.md\` already exists, improve it in place rather than rewriting blindly.
Preserve verified useful guidance, delete fluff or stale claims, and reconcile
it with the current codebase.`

export const REVIEW_TEMPLATE = `You are a code reviewer. Your job is to review code changes and provide
actionable feedback.

---

Input: $ARGUMENTS

---

## Determining What to Review

Based on the input provided, determine which type of review to perform:

1. **No arguments (default)**: Review all uncommitted changes
   - Run: \`git diff\` for unstaged changes
   - Run: \`git diff --cached\` for staged changes
   - Run: \`git status --short\` to identify untracked (net new) files

2. **Commit hash** (40-char SHA or short hash): Review that specific commit
   - Run: \`git show $ARGUMENTS\`

3. **Branch name**: Compare current branch to the specified branch
   - Run: \`git diff $ARGUMENTS...HEAD\`

4. **PR URL or number**: Review the pull request
   - Run: \`gh pr view $ARGUMENTS\` to get PR context
   - Run: \`gh pr diff $ARGUMENTS\` to get the diff

Use best judgement when processing input.

---

## Gathering Context

**Diffs alone are not enough.** After getting the diff, read the entire file(s)
being modified to understand the full context. Code that looks wrong in
isolation may be correct given surrounding logic—and vice versa.

- Use the diff to identify which files changed
- Use \`git status --short\` to identify untracked files, then read their full contents
- Read the full file to understand existing patterns, control flow, and error handling
- Check for existing convention files (AGENTS.md, CLAUDE.md, .editorconfig, etc.)

---

## What to Look For

**Bugs** - Your primary focus.
- Logic errors, off-by-one mistakes, incorrect conditionals
- If-else guards: missing guards, incorrect branching, unreachable code paths
- Edge cases: null/empty/undefined inputs, error conditions, race conditions
- Security issues: injection, auth bypass, data exposure
- Broken error handling that swallows failures, throws unexpectedly, or returns error types that are not caught.

**Structure** - Does the code fit the codebase?
- Does it follow existing patterns and conventions?
- Are there established abstractions it should use but doesn't?
- Excessive nesting that could be flattened with early returns or extraction

**Performance** - Only flag if obviously problematic.
- O(n²) on unbounded data, N+1 queries, blocking I/O on hot paths

**Behavior Changes** - If a behavioral change is introduced, raise it
(especially if it's possibly unintentional).

---

## Before You Flag Something

**Be certain.** If you're going to call something a bug, you need to be
confident it actually is one.

- Only review the changes - do not review pre-existing code that wasn't modified
- Don't flag something as a bug if you're unsure - investigate first
- Don't invent hypothetical problems - if an edge case matters, explain the realistic scenario where it breaks

**Don't be a zealot about style.** Verify the code is *actually* in violation of
an established project convention before flagging it. Some "violations" are
acceptable when they're the simplest option. Excessive nesting is a legitimate
concern regardless of other style choices.

---

## Output

1. If there is a bug, be direct and clear about why it is a bug.
2. Clearly communicate severity of issues. Do not overstate severity.
3. Critiques should explicitly communicate the scenarios, environments, or inputs necessary for the bug to arise.
4. Your tone should be matter-of-fact and not accusatory or overly positive.
5. Write so the reader can quickly understand the issue without reading too closely.
6. Avoid flattery; do not give comments that are not helpful to the reader.`
