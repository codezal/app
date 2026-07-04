const prefixes = {
  session: "ses",
  message: "msg",
  terminal: "pty",
  toast: "tst",
  job: "job",
  question: "que",
  approval: "apr",
  image: "img",
  pdf: "pdf",
  worker: "wrk",
  hook: "hk",
  monitor: "mon",
  workflow: "wf",
  wfAgent: "wfa",
  sdd: "sdd",
  llm: "llm",
  memory: "mem",
} as const

let lastTimestamp = 0
let counter = 0

function randomBase62(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62]
  }
  return result
}

export function createId(type: keyof typeof prefixes): string {
  const prefix = prefixes[type]
  const now = Date.now()

  if (now !== lastTimestamp) {
    lastTimestamp = now
    counter = 0
  }
  counter++

  const encoded = BigInt(now) * BigInt(0x1000) + BigInt(counter)

  const timeBytes = new Uint8Array(7)
  for (let i = 0; i < 7; i++) {
    timeBytes[i] = Number((encoded >> BigInt(48 - 8 * i)) & BigInt(0xff))
  }

  const hexTime = Array.from(timeBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return `${prefix}_${hexTime}${randomBase62(14)}`
}

export function extractTimestamp(id: string): number {
  const sep = id.indexOf("_")
  if (sep === -1) throw new Error(`Geçersiz ID: ${id}`)
  const hex = id.slice(sep + 1, sep + 15)
  return Number(BigInt("0x" + hex) / BigInt(0x1000))
}
