
export type WorkflowPhaseMeta = { title: string; detail?: string; model?: string }

export type WorkflowMeta = {
  name: string
  description: string
  whenToUse?: string
  phases?: WorkflowPhaseMeta[]
  model?: string
}

function extractBalanced(s: string, start: number): string {
  let depth = 0
  let inStr: string | null = null
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    const prev = s[i - 1]
    if (inStr) {
      if (c === inStr && prev !== "\\") inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  throw new Error("meta nesnesi kapanmıyor — `}` eksik")
}

// "/'-string, number, true/false/null/undefined, // ve /* */ yorum.
function parseObjectLiteral(src: string): unknown {
  let i = 0
  const fail = (msg: string): never => {
    throw new Error(`${msg} (pos ${i})`)
  }
  const skip = (): void => {
    for (;;) {
      const c = src[i]
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++
        continue
      }
      if (c === "/" && src[i + 1] === "/") {
        i += 2
        while (i < src.length && src[i] !== "\n") i++
        continue
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
        i += 2
        continue
      }
      break
    }
  }
  const parseString = (q: string): string => {
    i++
    let out = ""
    while (i < src.length) {
      const c = src[i++]
      if (c === "\\") {
        const e = src[i++]
        out +=
          e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "\n" ? "" : e
        continue
      }
      if (c === q) return out
      out += c
    }
    return fail("kapanmamış string")
  }
  const parseKey = (): string => {
    skip()
    const c = src[i]
    if (c === '"' || c === "'") return parseString(c)
    const start = i
    while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) i++
    if (i === start) fail("key bekleniyordu")
    return src.slice(start, i)
  }
  const parseValue = (): unknown => {
    skip()
    const c = src[i]
    if (c === '"' || c === "'") return parseString(c)
    if (c === "{") return parseObject()
    if (c === "[") return parseArray()
    const start = i
    while (i < src.length && !" \t\n\r,}]:/".includes(src[i]!)) i++
    const tok = src.slice(start, i)
    if (tok === "true") return true
    if (tok === "false") return false
    if (tok === "null") return null
    if (tok === "undefined") return undefined
    const n = Number(tok)
    if (tok !== "" && Number.isFinite(n)) return n
    return fail(`beklenmedik token '${tok}'`)
  }
  const parseObject = (): Record<string, unknown> => {
    i++ // {
    const obj: Record<string, unknown> = Object.create(null)
    for (;;) {
      skip()
      if (src[i] === "}") {
        i++
        break
      }
      const key = parseKey()
      skip()
      if (src[i] !== ":") fail("':' bekleniyordu")
      i++
      obj[key] = parseValue()
      skip()
      if (src[i] === ",") {
        i++
        continue
      }
      if (src[i] === "}") {
        i++
        break
      }
      fail("',' veya '}' bekleniyordu")
    }
    return obj
  }
  const parseArray = (): unknown[] => {
    i++ // [
    const arr: unknown[] = []
    for (;;) {
      skip()
      if (src[i] === "]") {
        i++
        break
      }
      arr.push(parseValue())
      skip()
      if (src[i] === ",") {
        i++
        continue
      }
      if (src[i] === "]") {
        i++
        break
      }
      fail("',' veya ']' bekleniyordu")
    }
    return arr
  }
  skip()
  const v = parseValue()
  skip()
  if (i < src.length) fail("fazladan içerik")
  return v
}

function validateMeta(obj: unknown): WorkflowMeta {
  if (!obj || typeof obj !== "object") throw new Error("meta bir nesne değil")
  const o = obj as Record<string, unknown>
  if (typeof o.name !== "string" || !o.name.trim()) {
    throw new Error("meta.name zorunlu (boş olmayan string)")
  }
  if (typeof o.description !== "string" || !o.description.trim()) {
    throw new Error("meta.description zorunlu (boş olmayan string)")
  }
  const phases = Array.isArray(o.phases)
    ? o.phases.map((p) => {
        const pp = (p ?? {}) as Record<string, unknown>
        return {
          title: String(pp.title ?? ""),
          detail: pp.detail != null ? String(pp.detail) : undefined,
          model: pp.model != null ? String(pp.model) : undefined,
        }
      })
    : undefined
  return {
    name: o.name,
    description: o.description,
    whenToUse: typeof o.whenToUse === "string" ? o.whenToUse : undefined,
    phases,
    model: typeof o.model === "string" ? o.model : undefined,
  }
}

export function parseMeta(script: string): WorkflowMeta {
  const m = script.match(/export\s+const\s+meta\s*=\s*\{/)
  if (!m) {
    throw new Error("Workflow script'i `export const meta = { … }` ile başlamalı")
  }
  const braceIdx = (m.index ?? 0) + m[0].length - 1
  const objText = extractBalanced(script, braceIdx)
  if (/\(|`|\.\.\./.test(objText)) {
    throw new Error("meta saf literal olmalı — fonksiyon çağrısı, spread, template literal yasak")
  }
  let obj: unknown
  try {
    obj = parseObjectLiteral(objText)
  } catch (e) {
    throw new Error(`meta parse edilemedi: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  return validateMeta(obj)
}
