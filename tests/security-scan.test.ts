import { describe, it, expect } from "vitest"
import {
  scanContent,
  scanToolInput,
  hasCriticalFinding,
  secretDenyGuidance,
  redactSecrets,
  type SecurityFinding,
} from "@/lib/security/scan"

// Helper — collect the rule ids fired for a snippet.
function rules(text: string): string[] {
  return scanContent(text).map((f) => f.rule)
}

describe("scanContent — credential formats (critical)", () => {
  const cases: Array<[string, string]> = [
    ["anthropic-key", 'const k = "sk-ant-api03-AbCdEf012345678901234567"'],
    ["openai-key", 'const k = "sk-proj-ABCDEFGHIJ0123456789abcdefghij"'],
    ["aws-access-key", 'aws = "AKIAIOSFODNN7EXAMPLE"'],
    ["gcp-api-key", 'g = "AIzaSyA1234567890abcdefghijklmnopqrstuv"'],
    ["github-token", 'gh = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"'],
    ["slack-token", 's = "xoxb-12345678901-abcdefABCDEF"'],
    ["stripe-key", 'p = "sk_live_0123456789abcdefghijABCD"'],
    ["npm-token", 'n = "npm_0123456789abcdefghijklmnopqrstuvwxyz"'],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
  ]

  for (const [rule, snippet] of cases) {
    it(`detects ${rule}`, () => {
      const found = scanContent(snippet)
      expect(found.map((f) => f.rule)).toContain(rule)
      expect(found.find((f) => f.rule === rule)?.severity).toBe("critical")
    })
  }

  it("reports the correct 1-based line number", () => {
    const text = 'const ok = 1\nconst k = "sk-ant-api03-AbCdEf012345678901234567"'
    const f = scanContent(text).find((x) => x.rule === "anthropic-key")
    expect(f?.line).toBe(2)
  })
})

describe("scanContent — masking", () => {
  it("never echoes the raw secret in the excerpt", () => {
    const secret = "sk-ant-api03-AbCdEf012345678901234567"
    const f = scanContent(`key = "${secret}"`)[0]
    expect(f.excerpt).not.toContain(secret)
    // Mask keeps a short recognizable prefix only.
    expect(f.excerpt).toContain("sk-a")
    expect(f.excerpt).toContain("•")
  })

  it("does not mask non-credential warning lines", () => {
    const f = scanContent("el.eval(x)").find((x) => x.rule === "eval-usage")
    expect(f?.excerpt).toContain("eval(")
  })
})

describe("scanContent — heuristics (warning)", () => {
  it("flags generic hardcoded secret assignment", () => {
    const f = scanContent('password = "hunter2hunter2"')
    expect(f.map((x) => x.rule)).toContain("generic-secret")
    expect(f[0].severity).toBe("warning")
  })

  it("flags eval, innerHTML, shell and sql injection", () => {
    expect(rules("const r = eval(userInput)")).toContain("eval-usage")
    expect(rules("<div dangerouslySetInnerHTML={{__html: x}} />")).toContain("inner-html")
    expect(rules("execSync(`rm -rf ${dir}`)")).toContain("shell-injection")
    expect(rules('db.query("SELECT * FROM u WHERE id = " + id)')).toContain("sql-injection")
  })
})

describe("scanContent — false positives avoided", () => {
  it("ignores env reads and placeholders for generic-secret", () => {
    expect(rules('const apiKey = process.env.API_KEY')).not.toContain("generic-secret")
    expect(rules('password = "your-password-here"')).not.toContain("generic-secret")
    expect(rules('token = "${MY_TOKEN}"')).not.toContain("generic-secret")
    expect(rules('secret = "<enter-your-secret>"')).not.toContain("generic-secret")
  })

  it("stays clean on ordinary code", () => {
    const code = [
      "function add(a, b) {",
      "  // sum two numbers",
      "  return a + b",
      "}",
      "export const NAME = 'codezal'",
    ].join("\n")
    expect(scanContent(code)).toHaveLength(0)
  })

  it("returns nothing for empty input", () => {
    expect(scanContent("")).toEqual([])
  })

  it("does not double-report a secret via the generic rule", () => {
    // A line that matches both anthropic-key and generic-secret must report once.
    const f = scanContent('api_key = "sk-ant-api03-AbCdEf012345678901234567"')
    expect(f).toHaveLength(1)
    expect(f[0].rule).toBe("anthropic-key")
  })
})

describe("scanToolInput", () => {
  it("scans write_file content", () => {
    const f = scanToolInput("write_file", {
      path: "a.ts",
      content: 'const k = "AKIAIOSFODNN7EXAMPLE"',
    })
    expect(f.map((x) => x.rule)).toContain("aws-access-key")
  })

  it("scans only the new_string of edit_file", () => {
    const f = scanToolInput("edit_file", {
      path: "a.ts",
      old_string: 'const k = "AKIAIOSFODNN7EXAMPLE"', // pre-existing — must NOT be flagged
      new_string: "const k = process.env.AWS_KEY",
    })
    expect(f).toHaveLength(0)
  })

  it("returns nothing for non-write tools", () => {
    expect(scanToolInput("bash", { command: 'echo "AKIAIOSFODNN7EXAMPLE"' })).toEqual([])
    expect(scanToolInput("read_file", { path: "a.ts" })).toEqual([])
  })
})

describe("hasCriticalFinding", () => {
  it("true only when a critical finding is present", () => {
    const warn: SecurityFinding[] = [
      { rule: "eval-usage", severity: "warning", line: 1, excerpt: "", message: "" },
    ]
    const crit: SecurityFinding[] = [
      { rule: "aws-access-key", severity: "critical", line: 1, excerpt: "", message: "" },
    ]
    expect(hasCriticalFinding(warn)).toBe(false)
    expect(hasCriticalFinding(crit)).toBe(true)
    expect(hasCriticalFinding([])).toBe(false)
  })
})

describe("scanContent — extended credential rules (v2)", () => {
  const cases: Array<[string, string]> = [
    ["google-oauth-secret", 'x = "GOCSPX-AbCdEf012345678901234567"'],
    ["gitlab-pat", 'x = "glpat-AbCdEf012345678901234"'],
    ["twilio-key", 'x = "SK0123456789abcdef0123456789abcdef"'],
    ["sendgrid-key", 'x = "SG.AbCdEfGhIjKlMnOp.QrStUvWxYz0123456789"'],
    ["mailgun-key", 'x = "key-0123456789abcdef0123456789abcdef"'],
    ["digitalocean-token", `x = "dop_v1_${"a".repeat(64)}"`],
    ["huggingface-token", 'x = "hf_AbCdEfGhIjKlMnOpQrStUvWxYz012345"'],
  ]
  for (const [rule, snippet] of cases) {
    it(`detects ${rule}`, () => {
      expect(scanContent(snippet).map((f) => f.rule)).toContain(rule)
    })
  }

  it("flags hardcoded JWT and slack webhook as warnings", () => {
    const jwt =
      "const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456'"
    expect(scanContent(jwt)[0]?.rule).toBe("jwt")
    expect(scanContent(jwt)[0]?.severity).toBe("warning")
    const hook = 'url = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX"'
    expect(scanContent(hook).map((f) => f.rule)).toContain("slack-webhook")
  })
})

describe("scanToolInput — apply_patch (v2)", () => {
  it("scans added (+) lines of an Add File block", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/config.ts",
      '+const k = "glpat-AbCdEf012345678901234"',
      "*** End Patch",
    ].join("\n")
    const f = scanToolInput("apply_patch", { patch })
    expect(f.map((x) => x.rule)).toContain("gitlab-pat")
  })

  it("scans only + lines in a hunk, ignoring context and deletions", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      " const ctx = 1",
      '-const old = "AKIAIOSFODNN7EXAMPLE"', // removed — must NOT be flagged
      '+const fresh = "SG.AbCdEfGhIjKlMnOp.QrStUvWxYz0123456789"',
      "*** End Patch",
    ].join("\n")
    const f = scanToolInput("apply_patch", { patch })
    expect(f.map((x) => x.rule)).toEqual(["sendgrid-key"])
  })
})

describe("secretDenyGuidance (v2)", () => {
  it("returns an actionable env-var instruction for critical findings", () => {
    const f = scanContent('k = "AKIAIOSFODNN7EXAMPLE"')
    const msg = secretDenyGuidance(f)
    expect(msg).toContain("process.env")
    expect(msg).toContain("aws-access-key")
    expect(msg).toContain(".env")
  })

  it("returns null when there is nothing credential-grade", () => {
    expect(secretDenyGuidance(scanContent("const r = eval(x)"))).toBeNull()
    expect(secretDenyGuidance([])).toBeNull()
  })
})

describe("redactSecrets — mask credentials in free-form text", () => {
  it("masks a token carried in a network request URL", () => {
    const line = "[GET] 200 https://api.example.com/data?token=ghp_0123456789abcdefghijklmnopqrstuvwxyz (42ms)"
    const out = redactSecrets(line)
    // Raw secret must not survive; the surrounding URL/structure stays readable.
    expect(out).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz")
    expect(out).toContain("•")
    expect(out).toContain("https://api.example.com/data")
    expect(out).toContain("(42ms)")
  })

  it("leaves secret-free text untouched", () => {
    const line = "[POST] 201 https://api.example.com/users (88ms)"
    expect(redactSecrets(line)).toBe(line)
  })

  it("masks every occurrence across multiple lines", () => {
    const text = [
      'aws = "AKIAIOSFODNN7EXAMPLE"',
      'aws2 = "AKIAIOSFODNN7EXAMPLE"',
    ].join("\n")
    const out = redactSecrets(text)
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE")
  })
})
