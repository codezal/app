export type AutopilotTemplate = {
  id: string
  name: string
  description: string
  schedule: string
  prompt: string
}

const REPORT_TAIL =
  "Output: a concise report with findings, risks and the next concrete actions. " +
  "Constraints: stay read-only unless I approve; never send or write without confirmation. " +
  "Sources: cite a link or file reference for every claim. " +
  "Done when: the objective is met or no new signal is found — then stop."

export const AUTOPILOT_TEMPLATES: AutopilotTemplate[] = [
  {
    id: "pr-digest",
    name: "PR review digest",
    description: "Open PRs, review status and what needs attention.",
    schedule: "0 21 * * 1-5",
    prompt: `Review the open pull requests in this repository. Summarize each by status, what's blocking it, and what needs my attention. ${REPORT_TAIL}`,
  },
  {
    id: "dep-check",
    name: "Dependency update check",
    description: "Outdated packages, security patches and breaking changes.",
    schedule: "30 21 * * 1",
    prompt: `Scan this project's dependencies for outdated packages, security advisories and breaking changes. Prioritize by severity. ${REPORT_TAIL}`,
  },
  {
    id: "flaky-tests",
    name: "Flaky test tracker",
    description: "Tests that pass and fail intermittently across recent runs.",
    schedule: "0 19 * * 1",
    prompt: `Inspect recent test / CI output for tests that pass and fail intermittently. List the suspected flaky tests with evidence. ${REPORT_TAIL}`,
  },
  {
    id: "release-notes",
    name: "Release notes drafter",
    description: "Draft user-facing release notes from recent merges.",
    schedule: "",
    prompt: `Draft user-facing release notes from the changes merged since the last release. Group by feature / fix. Read-only: produce a draft only. ${REPORT_TAIL}`,
  },
  {
    id: "daily-briefing",
    name: "Daily briefing",
    description: "Short morning summary of what changed and what to do next.",
    schedule: "0 9 * * 1-5",
    prompt: `Give me a short morning briefing: what changed in this project recently, what matters, and what I should do next. Keep it short and actionable. ${REPORT_TAIL}`,
  },
  {
    id: "us-iran-ceasefire",
    name: "US–Iran ceasefire monitor",
    description: "Track US–Iran ceasefire likelihood from live news + prediction markets.",
    schedule: "0 * * * *",
    prompt: `Monitor the latest developments on US–Iran relations and estimate the probability of a ceasefire.

Each run:
1. Use web search to gather the most recent headlines / developments on US–Iran tensions and ceasefire talks (last few hours).
2. If reachable, fetch the current implied probability from a prediction market (e.g. Polymarket / Kalshi "Iran ceasefire" market) and treat that number as the calibration anchor.
3. Produce a single probability estimate (0–100%) for a ceasefire within the stated horizon, and the change (delta) vs. the previous run if you can infer it.

Report (concise):
- probability: NN%  (and delta vs. last run if known)
- top 3 drivers moving it, each with a source link
- market anchor: the prediction-market number if found
- risks / what could flip it

Constraints: stay strictly read-only — do not post, trade, send or write anything. Cite a source link for every claim. This is a model estimate, NOT financial or investment advice. Done when the report is produced — then stop.`,
  },
]
