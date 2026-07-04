
export type WordSeg = { text: string; changed: boolean }

export type DiffLine = {
  kind: "add" | "del" | "ctx"
  text: string
  oldNo?: number
  newNo?: number
  segs?: WordSeg[]
}

const MAX_LCS_CELLS = 4_000_000

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split(/\r?\n/)
  const b = newText.split(/\r?\n/)
  if (a.length * b.length > MAX_LCS_CELLS) {
    const big: DiffLine[] = []
    for (let i = 0; i < a.length; i++) big.push({ kind: "del", text: a[i], oldNo: i + 1 })
    for (let j = 0; j < b.length; j++) big.push({ kind: "add", text: b[j], newNo: j + 1 })
    return big
  }
  const lcs = lcsTable(a, b)
  const out: DiffLine[] = []
  let i = a.length
  let j = b.length
  const stack: DiffLine[] = []
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      stack.push({ kind: "ctx", text: a[i - 1], oldNo: i, newNo: j })
      i--
      j--
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      stack.push({ kind: "del", text: a[i - 1], oldNo: i })
      i--
    } else {
      stack.push({ kind: "add", text: b[j - 1], newNo: j })
      j--
    }
  }
  while (i > 0) {
    stack.push({ kind: "del", text: a[i - 1], oldNo: i })
    i--
  }
  while (j > 0) {
    stack.push({ kind: "add", text: b[j - 1], newNo: j })
    j--
  }
  while (stack.length) {
    const x = stack.pop()
    if (x) out.push(x)
  }
  return out
}

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) t[i][j] = t[i - 1][j - 1] + 1
      else t[i][j] = Math.max(t[i - 1][j], t[i][j - 1])
    }
  }
  return t
}

export function trimContext(lines: DiffLine[], contextLines = 2): DiffLine[] {
  if (lines.every((l) => l.kind === "ctx")) return []

  const keep = new Set<number>()
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].kind !== "ctx") {
      for (let k = -contextLines; k <= contextLines; k++) {
        const ni = idx + k
        if (ni >= 0 && ni < lines.length) keep.add(ni)
      }
    }
  }
  const out: DiffLine[] = []
  let prev = -1
  for (const i of Array.from(keep).sort((x, y) => x - y)) {
    if (prev !== -1 && i - prev > 1) {
      out.push({ kind: "ctx", text: "…" })
    }
    out.push(lines[i])
    prev = i
  }
  return out
}

export function hunksForEdit(
  oldString: string,
  newString: string,
  contextLines = 2,
): DiffLine[] {
  return trimContext(lineDiff(oldString, newString), contextLines)
}


function tokenize(line: string): string[] {
  return line.match(/(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+)/g) ?? []
}

function mergeSegs(tokens: string[], changed: boolean[]): WordSeg[] {
  const out: WordSeg[] = []
  for (let k = 0; k < tokens.length; k++) {
    const c = changed[k]
    const last = out[out.length - 1]
    if (last && last.changed === c) last.text += tokens[k]
    else out.push({ text: tokens[k], changed: c })
  }
  return out
}

export function wordDiff(
  oldLine: string,
  newLine: string,
): { del: WordSeg[]; add: WordSeg[] } {
  const a = tokenize(oldLine)
  const b = tokenize(newLine)
  const t = lcsTable(a, b)
  const delChanged = new Array<boolean>(a.length).fill(true)
  const addChanged = new Array<boolean>(b.length).fill(true)
  let i = a.length
  let j = b.length
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      delChanged[i - 1] = false
      addChanged[j - 1] = false
      i--
      j--
    } else if (t[i - 1][j] >= t[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return { del: mergeSegs(a, delChanged), add: mergeSegs(b, addChanged) }
}

export function annotateIntraline(lines: DiffLine[]): DiffLine[] {
  const out = lines.map((l) => ({ ...l }))
  let k = 0
  while (k < out.length) {
    if (out[k].kind !== "del") {
      k++
      continue
    }
    let delEnd = k
    while (delEnd < out.length && out[delEnd].kind === "del") delEnd++
    let addEnd = delEnd
    while (addEnd < out.length && out[addEnd].kind === "add") addEnd++
    const n = delEnd - k
    if (n > 0 && addEnd - delEnd === n) {
      for (let p = 0; p < n; p++) {
        const dl = out[k + p]
        const al = out[delEnd + p]
        const { del, add } = wordDiff(dl.text, al.text)
        const unchanged = del
          .filter((s) => !s.changed)
          .reduce((sum, s) => sum + s.text.length, 0)
        const ratio = unchanged / Math.max(dl.text.length, al.text.length, 1)
        if (ratio >= 0.25) {
          dl.segs = del
          al.segs = add
        }
      }
    }
    k = Math.max(addEnd, k + 1)
  }
  return out
}
