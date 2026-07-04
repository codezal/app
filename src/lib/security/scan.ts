// Pre-write security scan — surfaces leaked credentials and risky patterns in
// AI-generated content BEFORE it touches disk.
//
// Why this exists: research on AI-assisted ("vibe") coding consistently finds
// hardcoded secrets and a handful of injection patterns as the most common,
// highest-impact failure. A leaked key is irreversible once committed/pushed,
// so catching it at the approval boundary is the cheapest possible fix.
//
// Design constraints:
//  - Pure, dependency-free, synchronous — runs inside the approval store and is
//    unit-tested in the node environment (no Tauri, no DOM).
//  - Two severities. `critical` = unmistakable credential token formats (very
//    low false-positive rate) → the approval layer ESCALATES these to the modal
//    even in bypass/auto-review mode. `warning` = heuristic patterns that are
//    informational only and never block, to avoid false-positive fatigue (the
//    documented reason vibe coders disable security tooling).
//  - Never emit a full secret. Matched credential substrings are masked so the
//    value is not echoed into the modal, logs, or persisted approval state.

export type SecuritySeverity = "critical" | "warning"

export type SecurityFinding = {
  // Stable rule id, e.g. "anthropic-key". Used as a React key and for tests.
  rule: string
  severity: SecuritySeverity
  // 1-based line number within the scanned text.
  line: number
  // The offending line, truncated and with any secret value masked. Safe to
  // render and to persist — never contains the raw credential.
  excerpt: string
  // Short English description of the problem. English by the on-disk language
  // rule; the modal localizes only the surrounding chrome.
  message: string
}

// A single detection rule. `mask` is true for credential formats whose match
// must be redacted before display.
type Rule = {
  id: string
  severity: SecuritySeverity
  message: string
  re: RegExp
  mask: boolean
  // Optional guard — return true to DROP a match (false positive). Receives the
  // full matched text and the whole line for context.
  ignore?: (match: string, line: string) => boolean
}

// Values that look like a secret assignment but are clearly placeholders or
// indirection, not a real hardcoded credential. Keeps the heuristic
// `generic-secret` rule from crying wolf on env reads and templates.
const PLACEHOLDER_RE =
  /(process\.env|import\.meta\.env|os\.environ|getenv|ENV\[|\$\{|<[^>]+>|your[_-]?|example|changeme|placeholder|redacted|dummy|sample|xxxx|\*\*\*\*|\.\.\.|enter[_-]?your|put[_-]?your|todo|fixme)/i

// Maximum characters of a line we surface in an excerpt — defends against a
// minified single-line blob blowing up the modal.
const MAX_EXCERPT = 160

// Rules are evaluated in order; earlier rules win a given character span so a
// generic rule does not double-report a span already claimed by a specific one.
const RULES: Rule[] = [
  // ---- critical: unambiguous credential token formats ---------------------
  {
    id: "anthropic-key",
    severity: "critical",
    message: "Anthropic API key detected",
    re: /sk-ant-[A-Za-z0-9_-]{16,}/g,
    mask: true,
  },
  {
    id: "openai-key",
    severity: "critical",
    message: "OpenAI API key detected",
    // Exclude the Anthropic prefix so it is not double-reported.
    re: /sk-(?!ant-)(?:proj-)?[A-Za-z0-9]{20,}/g,
    mask: true,
  },
  {
    id: "aws-access-key",
    severity: "critical",
    message: "AWS access key id detected",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    mask: true,
  },
  {
    id: "gcp-api-key",
    severity: "critical",
    message: "Google API key detected",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    mask: true,
  },
  {
    id: "github-token",
    severity: "critical",
    message: "GitHub token detected",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    mask: true,
  },
  {
    id: "slack-token",
    severity: "critical",
    message: "Slack token detected",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    mask: true,
  },
  {
    id: "stripe-key",
    severity: "critical",
    message: "Stripe live secret key detected",
    re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
    mask: true,
  },
  {
    id: "npm-token",
    severity: "critical",
    message: "npm access token detected",
    re: /\bnpm_[A-Za-z0-9]{36}\b/g,
    mask: true,
  },
  {
    id: "google-oauth-secret",
    severity: "critical",
    message: "Google OAuth client secret detected",
    re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
    mask: true,
  },
  {
    id: "gitlab-pat",
    severity: "critical",
    message: "GitLab personal access token detected",
    re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    mask: true,
  },
  {
    id: "twilio-key",
    severity: "critical",
    message: "Twilio API key detected",
    re: /\bSK[0-9a-f]{32}\b/g,
    mask: true,
  },
  {
    id: "sendgrid-key",
    severity: "critical",
    message: "SendGrid API key detected",
    re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
    mask: true,
  },
  {
    id: "mailgun-key",
    severity: "critical",
    message: "Mailgun API key detected",
    re: /\bkey-[0-9a-f]{32}\b/g,
    mask: true,
  },
  {
    id: "digitalocean-token",
    severity: "critical",
    message: "DigitalOcean access token detected",
    re: /\bdop_v1_[a-f0-9]{64}\b/g,
    mask: true,
  },
  {
    id: "huggingface-token",
    severity: "critical",
    message: "Hugging Face access token detected",
    re: /\bhf_[A-Za-z0-9]{30,}\b/g,
    mask: true,
  },
  {
    id: "private-key",
    severity: "critical",
    message: "Private key block detected",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    mask: false,
  },

  // ---- warning: heuristics (never escalate, informational) ----------------
  {
    id: "generic-secret",
    severity: "warning",
    message: "Possible hardcoded secret — prefer an env var",
    // key-ish identifier assigned a quoted literal of meaningful length.
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
    mask: true,
    ignore: (_m, line) => PLACEHOLDER_RE.test(line),
  },
  {
    id: "eval-usage",
    severity: "warning",
    message: "eval() can execute injected code",
    re: /\beval\s*\(/g,
    mask: false,
  },
  {
    id: "inner-html",
    severity: "warning",
    message: "dangerouslySetInnerHTML can enable XSS",
    re: /dangerouslySetInnerHTML/g,
    mask: false,
  },
  {
    id: "shell-injection",
    severity: "warning",
    message: "Shell command built from interpolation — injection risk",
    re: /\bexec(?:Sync)?\s*\(\s*[`"'][^`"']*\$\{/g,
    mask: false,
  },
  {
    id: "sql-injection",
    severity: "warning",
    message: "SQL string built from interpolation/concatenation — injection risk",
    re: /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"'`\n]*(?:\$\{|"\s*\+|'\s*\+|`\s*\+)/gi,
    mask: false,
  },
  {
    id: "jwt",
    severity: "warning",
    message: "Hardcoded JWT — may be a session/credential token",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    mask: true,
  },
  {
    id: "slack-webhook",
    severity: "warning",
    message: "Slack webhook URL — keep it out of source",
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/]+/g,
    mask: true,
  },
]

// Mask a credential so the raw value never leaves this module. Keeps a short
// prefix/suffix for recognizability ("sk-ant-…AA12") when the value is long
// enough, otherwise fully redacts.
function maskSecret(secret: string): string {
  if (secret.length <= 8) return "•".repeat(secret.length)
  return `${secret.slice(0, 4)}…${"•".repeat(6)}${secret.slice(-2)}`
}

// Build a safe excerpt for a line: mask the matched span (if required) then
// trim whitespace and cap the length.
function buildExcerpt(line: string, match: string, mask: boolean): string {
  let out = line
  if (mask) out = out.split(match).join(maskSecret(match))
  out = out.trim()
  if (out.length > MAX_EXCERPT) out = `${out.slice(0, MAX_EXCERPT)}…`
  return out
}

// Mask secret-bearing spans (rules with mask:true) in free-form text so raw
// credentials never reach the model. Used for tool output that may echo
// secrets — e.g. captured network request URLs carrying query-param tokens.
// Non-secret rules (risky patterns) are left untouched; only credentials masked.
export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const rule of RULES) {
    if (!rule.mask) continue
    rule.re.lastIndex = 0
    out = out.replace(rule.re, (m) => maskSecret(m))
  }
  return out
}

// Scan free-form text and return findings. `filename` is currently unused but
// kept in the signature so language-specific rules can be added without
// touching call sites.
export function scanContent(text: string, _filename?: string): SecurityFinding[] {
  if (!text) return []
  const findings: SecurityFinding[] = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip pathologically long lines from per-character rules but still allow a
    // cheap secret check — minified bundles are mostly noise.
    const scanLine = line.length > 4000 ? line.slice(0, 4000) : line
    // Track spans already claimed by an earlier (more specific) rule so a
    // generic rule does not re-report the same credential.
    const claimed: Array<[number, number]> = []

    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.re.exec(scanLine)) !== null) {
        const matched = m[0]
        const start = m.index
        const end = start + matched.length
        // Avoid zero-width infinite loops on pathological patterns.
        if (matched.length === 0) {
          rule.re.lastIndex++
          continue
        }
        if (rule.ignore?.(matched, scanLine)) continue
        const overlaps = claimed.some(([s, e]) => start < e && end > s)
        if (overlaps) continue
        claimed.push([start, end])
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          line: i + 1,
          excerpt: buildExcerpt(line, matched, rule.mask),
          message: rule.message,
        })
      }
    }
  }
  return findings
}

// Derive findings from a write/edit tool input. Only the NEW content is scanned
// (write_file.content, edit_file.new_string) so pre-existing code in the file is
// never flagged — the gate is about what THIS change introduces.
export function scanToolInput(tool: string, input: unknown): SecurityFinding[] {
  const i = (input as Record<string, unknown>) ?? {}
  const path = typeof i.path === "string" ? i.path : undefined
  if (tool === "write_file") {
    return scanContent(typeof i.content === "string" ? i.content : "", path)
  }
  if (tool === "edit_file") {
    return scanContent(typeof i.new_string === "string" ? i.new_string : "", path)
  }
  if (tool === "apply_patch") {
    // apply_patch input is a unified-diff-style string; every inserted line is
    // marked with a leading '+' (both in *** Add File blocks and @@ hunks).
    // Scan only those added lines so untouched/removed context is never flagged.
    const patch = typeof i.patch === "string" ? i.patch : ""
    const added = patch
      .split(/\r?\n/)
      .filter((l) => l.startsWith("+"))
      .map((l) => l.slice(1))
      .join("\n")
    return scanContent(added, path)
  }
  return []
}

// True when any finding warrants forcing the approval modal (escalation) even
// in bypass/auto-review mode. Only credential-grade findings qualify.
export function hasCriticalFinding(findings: readonly SecurityFinding[]): boolean {
  return findings.some((f) => f.severity === "critical")
}

// Build an actionable, model-facing instruction for a write that was denied
// because it carried credential-grade secrets. The gate throws this as the tool
// error so the model self-corrects (switches to an env var) and retries, rather
// than just seeing a generic "user rejected" and giving up. Returns null when
// there is nothing credential-grade to act on (so the caller falls back to the
// normal deny message). English by the on-disk language rule — it instructs the
// model on a code fix; any user-facing summary is localized by the model.
export function secretDenyGuidance(findings: readonly SecurityFinding[]): string | null {
  const crit = findings.filter((f) => f.severity === "critical")
  if (crit.length === 0) return null
  const list = crit.map((f) => `${f.rule} (line ${f.line})`).join(", ")
  return (
    `Blocked: the content contains hardcoded secrets — ${list}. ` +
    `Never hardcode credentials. Replace each secret literal with a reference to an ` +
    `environment variable (e.g. process.env.SECRET_NAME or import.meta.env.VITE_SECRET_NAME), ` +
    `and tell the user to store the real value in a gitignored .env file. Then retry the write.`
  )
}
