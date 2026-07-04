
export type Frontmatter = {
  data: Record<string, unknown>
  body: string
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s[0]
    const b = s[s.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1)
  }
  return s
}

function parseValue(v: string): string | string[] {
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((x) => stripQuotes(x.trim()))
      .filter(Boolean)
  }
  return stripQuotes(v)
}

function fold(lines: string[]): string {
  const out: string[] = []
  let buf: string[] = []
  for (const l of lines) {
    if (l.trim() === "") {
      if (buf.length) {
        out.push(buf.join(" "))
        buf = []
      }
      out.push("")
    } else {
      buf.push(l.trim())
    }
  }
  if (buf.length) out.push(buf.join(" "))
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export function parseFrontmatter(raw: string): Frontmatter {
  const src = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const m = src.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: raw }

  const lines = m[1].split("\n")
  const body = m[2]
  const data: Record<string, unknown> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++
      continue
    }
    const km = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!km) {
      i++
      continue
    }
    const key = km[1].trim()
    const rest = km[2].trim()

    if (/^[|>][+-]?$/.test(rest)) {
      const folded = rest.startsWith(">")
      const collected: string[] = []
      let baseIndent: number | null = null
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === "") {
          collected.push("")
          i++
          continue
        }
        const indent = l.length - l.trimStart().length
        if (baseIndent === null) {
          if (indent === 0) break // girinti yok → blok bitti
          baseIndent = indent
        }
        if (indent < baseIndent) break
        collected.push(l.slice(baseIndent))
        i++
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop()
      data[key] = folded ? fold(collected) : collected.join("\n")
      continue
    }

    if (rest !== "") {
      data[key] = parseValue(rest)
      i++
      continue
    }

    const items: string[] = []
    let j = i + 1
    while (j < lines.length) {
      const l = lines[j]
      if (l.trim() === "") {
        j++
        continue
      }
      const lm = l.match(/^\s+-\s+(.*)$/)
      if (!lm) break
      items.push(stripQuotes(lm[1].trim()))
      j++
    }
    if (items.length) {
      data[key] = items
      i = j
      continue
    }

    data[key] = ""
    i++
  }

  return { data, body }
}
