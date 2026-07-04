// Pre-exec DANGER guard for bash — escalates destructive and data-exfiltration
// commands to the approval modal even in auto-review/bypass, mirroring the
// credential-scan (scan.ts) and destination-path (sensitive-paths.ts) escalations.
//
// Why this is needed: codezal's default approvalMode is "bypass", which maps to
// `{"*":"allow"}` — so every bash command auto-runs with no inspection. The
// `checkDanger` regex in ApprovalModal only paints a "risky" badge on a modal
// that, under bypass, never opens. That left `rm -rf $HOME`, `rm -rf /`,
// `curl … | sh`, and `tar … | curl` running unguarded. By returning `critical`
// SecurityFindings here, those commands flow through the EXISTING
// hasCriticalFinding escalation in the approval store and force the modal open
// even under bypass — without changing the default mode.
//
// This ESCALATES (prompts), it does not silently block: a real `rm -rf /` from
// the user still runs once they approve. The goal is to stop a model (or a
// prompt-injected instruction) from destroying the machine or exfiltrating the
// repo with zero confirmation. Pure + node-testable; shares the `securityScan`
// settings toggle. Findings carry `line: 0` (command-level, no content line).

import type { SecurityFinding } from "./scan"
import { classifySensitiveWrite } from "./sensitive-paths"

const MAX_EXCERPT = 160

// Symbolic roots whose recursive-force deletion is catastrophic. Compared after
// normalizeTarget() strips quotes and trailing slashes — which is exactly how the
// upstream `rm -rf $HOME` + trailing-slash bug slips past a naive guard.
const DANGEROUS_ROOTS = new Set([
  "/",
  "/*",
  "~",
  "~/*",
  "$HOME",
  "${HOME}",
  "$HOME/*",
  "${HOME}/*",
  // Windows
  "C:",
  "%USERPROFILE%",
  "%HOMEPATH%",
])

// Strip surrounding quotes and collapse trailing slashes (so `$HOME/` → `$HOME`,
// `//` → `/`, `~/` → `~`). The lone root `/` is preserved.
function normalizeTarget(tok: string): string {
  const unquoted = tok.replace(/^['"]+|['"]+$/g, "")
  const trimmed = unquoted.replace(/\/+$/, "")
  return trimmed === "" ? "/" : trimmed
}

// True when a command segment is `rm` with BOTH recursive and force flags
// (any spelling: -rf, -fr, -Rf, -r -f, --recursive --force) AND one of its
// non-flag arguments resolves to a dangerous root. Split on shell separators so
// each `rm` is judged with its own arguments.
//
// Also catches variable-indirection bypasses (`X=rm; $X -rf /`, `eval rm -rf ~`):
// when a segment's command word — after skipping leading `VAR=val` assignments —
// is a `$VAR`/`${VAR}` expansion or `eval`, its remaining args are scanned the
// same way. The dangerous-root requirement keeps this from flagging benign
// indirect calls like `$EDITOR -rf /tmp/x` (target is not a root/home).
function hasDangerousRm(cmd: string): boolean {
  for (const seg of cmd.split(/[;&|\n]+/)) {
    let rest: string | null = null
    const m = seg.match(/\brm\b(.*)/s)
    if (m) {
      rest = m[1]
    } else {
      // No literal `rm` — check for an indirect invocation. Skip env-var
      // assignments (`FOO=bar`) to find the real command word.
      const toks = seg.trim().split(/\s+/)
      let ci = 0
      while (ci < toks.length && /^\w+=/.test(toks[ci]!)) ci++
      const head = toks[ci] ?? ""
      if (/^\$\{?\w+\}?$/.test(head) || head === "eval") {
        rest = toks.slice(ci + 1).join(" ")
      }
    }
    if (rest == null) continue
    const hasR = /(?:^|\s)-[a-zA-Z]*r[a-zA-Z]*(?:\s|$)/i.test(rest) || /--recursive\b/.test(rest)
    const hasF = /(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?:\s|$)/.test(rest) || /--force\b/.test(rest)
    if (!hasR || !hasF) continue
    for (const tok of rest.split(/\s+/)) {
      if (!tok || tok.startsWith("-")) continue
      if (DANGEROUS_ROOTS.has(normalizeTarget(tok))) return true
    }
  }
  return false
}

// Windows catastrophic recursive delete — PowerShell `Remove-Item -Recurse` (and
// its `ri` alias) plus cmd.exe `rd`/`rmdir`/`del`/`erase` with `/s` against a
// drive root or user-profile path. Bash's `rm` guard above does not cover these
// (different command + flag syntax), and this app ships for Windows too. Mirrors
// hasDangerousRm: split on separators, require a recursive flag, require a
// root/home target. `C:\*` and `C:\` both count as the root.
const WIN_ROOT = /^(?:[a-z]:\\?\*?|~|\$home|\$env:(?:userprofile|homepath)|%(?:userprofile|homepath)%)$/i

function hasDangerousWinDelete(cmd: string): boolean {
  for (const seg of cmd.split(/[;&|\n]+/)) {
    // PowerShell Remove-Item / `ri` alias, or cmd.exe rd/rmdir/del/erase.
    const isPwshRm = /\bremove-item\b/i.test(seg) || /(?:^|\s)ri\b/i.test(seg)
    const isCmdDel = /(?:^|\s)(?:rd|rmdir|del|erase)\b/i.test(seg)
    if (!isPwshRm && !isCmdDel) continue
    const recursive = /-recurse\b/i.test(seg) || /(?:^|\s)-r\b/i.test(seg) || /(?:^|\s)\/s\b/i.test(seg)
    if (!recursive) continue
    for (const raw of seg.split(/\s+/)) {
      const t = raw.replace(/^['"]+|['"]+$/g, "").replace(/[\\/]+$/, "")
      if (t && WIN_ROOT.test(t)) return true
    }
  }
  return false
}

// Extract `>`/`>>` redirection targets (and `tee` destinations) from a command,
// so a write that lands on an execution-granting file via the shell is caught
// the same way a write_file/edit_file to that path would be. fd prefixes
// (`2>`, `&>`) are tolerated; the captured token is the destination path.
function redirectionTargets(cmd: string): string[] {
  const out: string[] = []
  // fd? >/>> target — a double/single-quoted path (spaces included) or a bare
  // token. Quoting lets a destination like `> "$HOME/My Dir/.zshrc"` survive.
  const redir = /(?:[0-9]+|&)?>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s"'|;&<>]+))/g
  let m: RegExpExecArray | null
  while ((m = redir.exec(cmd))) {
    const t = m[1] ?? m[2] ?? m[3]
    if (t) out.push(t)
  }
  // `… | tee [-a] <file>` writes to its file argument too (same quoting rules).
  const tee = /\btee\b(?:\s+-\S+)*\s+(?:"([^"]+)"|'([^']+)'|([^\s"'|;&]+))/g
  while ((m = tee.exec(cmd))) {
    const t = m[1] ?? m[2] ?? m[3]
    if (t && !t.startsWith("-")) out.push(t)
  }
  return out
}

// Categorical command rules — dangerous regardless of target path. Each match
// produces one critical finding. Order independent; deduped by id.
type BashRule = { id: string; message: string; re: RegExp }

const BASH_RULES: BashRule[] = [
  {
    id: "dd-device",
    message: "Writes raw data to a disk device (dd of=/dev/…) — can destroy a drive",
    re: /\bdd\b[^|;&\n]*\bof=\/dev\//,
  },
  {
    id: "mkfs",
    message: "Formats a filesystem (mkfs) — destroys all data on the target",
    re: /\bmkfs(?:\.\w+)?\b/,
  },
  {
    id: "block-device-write",
    message: "Redirects output onto a raw disk device",
    re: />\s*\/dev\/(?:sd|nvme|disk\d|hd[a-z])/,
  },
  {
    id: "fork-bomb",
    message: "Fork bomb — exhausts system processes",
    re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    id: "chmod-recursive-root",
    message: "Recursive permission change on a root or home path",
    re: /\bchmod\b[^|;&\n]*-[a-zA-Z]*R[a-zA-Z]*[^|;&\n]*\s(?:\/|~|\$\{?HOME\}?)(?:\s|\/|$)/,
  },
  {
    id: "remote-exec",
    message: "Downloads and pipes a script straight into a shell (remote code execution)",
    re: /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|ksh|python3?|perl|ruby|node)\b/,
  },
  {
    id: "data-exfil-pipe",
    message: "Pipes data into a network tool (possible data exfiltration)",
    re: /\|\s*(?:curl|wget|nc|ncat|netcat)\b/,
  },
  {
    id: "data-exfil-upload",
    message: "Uploads file contents over the network (possible data exfiltration)",
    re: /\b(?:curl|wget)\b[^|;&\n]*(?:--upload-file|\s-T\s|--data-binary\s+@|\s-d\s+@|--data\s+@)/,
  },
]

function excerptOf(s: string): string {
  const t = s.trim()
  return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT)}…` : t
}

// Derive danger findings from a bash tool input. Returns `critical` findings so
// the approval layer escalates to the modal even in bypass/auto-review. Only the
// `bash` tool runs commands (bash_status only reads/kills existing jobs).
export function dangerousBashFindings(tool: string, input: unknown): SecurityFinding[] {
  if (tool !== "bash") return []
  const cmd = typeof (input as Record<string, unknown>)?.command === "string"
    ? ((input as Record<string, unknown>).command as string)
    : ""
  if (!cmd.trim()) return []

  const findings: SecurityFinding[] = []
  const seen = new Set<string>()
  const add = (rule: string, message: string, snippet: string) => {
    if (seen.has(rule)) return
    seen.add(rule)
    findings.push({ rule, severity: "critical", line: 0, excerpt: excerptOf(snippet), message })
  }

  if (hasDangerousRm(cmd)) {
    add("dangerous-rm", "Recursive force delete of a root or home directory", cmd)
  }
  if (hasDangerousWinDelete(cmd)) {
    add("dangerous-win-delete", "Windows recursive delete of a drive root or home directory", cmd)
  }
  for (const r of BASH_RULES) {
    const m = cmd.match(r.re)
    if (m) add(r.id, r.message, m[0])
  }
  // A redirection (or `tee`) whose destination is an execution-granting file
  // (shell rc, Git config/hook, build config) escalates just like a direct write.
  for (const target of redirectionTargets(cmd)) {
    const c = classifySensitiveWrite(target)
    if (c) add(`redirect-${c.rule}`, c.message, `> ${target}`)
  }
  return findings
}
