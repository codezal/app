//

export type PiiType =
  | "EMAIL"
  | "PHONE"
  | "SSN"
  | "CARD"
  | "IBAN"
  | "AWS_KEY"
  | "GH_TOKEN"
  | "PRIVATE_KEY"
  | "JWT"
  | "IP"
  | "SECRET"
  | "CUSTOM"

export interface Detection {
  type: PiiType
  value: string
  start: number
  end: number
  label?: string
}

interface PatternDef {
  type: PiiType
  re: RegExp
  group?: number
  validate?: (matchText: string) => boolean
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "")
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

function digitCountIn(s: string, min: number, max: number): boolean {
  const n = (s.match(/\d/g) ?? []).length
  return n >= min && n <= max
}

export const BUILTIN_PATTERNS: PatternDef[] = [
  {
    type: "PRIVATE_KEY",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  { type: "AWS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "GH_TOKEN", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { type: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "IBAN", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{0,3}\b/g, validate: (m) => digitCountIn(m, 6, 34) },
  { type: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, validate: luhnValid },
  {
    type: "SECRET",
    re: /(?:api[_-]?key|secret|token|password|passwd|pwd|bearer|authorization)["'\s:=]+([A-Za-z0-9._+/-]{12,})/gi,
    group: 1,
  },
  {
    type: "PHONE",
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{2,4}\b/g,
    validate: (m) => digitCountIn(m, 7, 15),
  },
  { type: "IP", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

export const DEFAULT_DETECTORS: Record<PiiType, boolean> = {
  EMAIL: true,
  PHONE: true,
  SSN: true,
  CARD: true,
  IBAN: true,
  AWS_KEY: true,
  GH_TOKEN: true,
  PRIVATE_KEY: true,
  JWT: true,
  SECRET: true,
  IP: false,
  CUSTOM: true,
}
