// Basit line diff — old_string + new_string → satır bazlı diff.
// LCS tabanlı; küçük bloklar için yeterli (edit_file tool çıktısı).
export type DiffLine = {
  kind: "add" | "del" | "ctx"
  text: string
  oldNo?: number
  newNo?: number
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split(/\r?\n/)
  const b = newText.split(/\r?\n/)
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

// Tool input + result'tan diff hesapla; bağlam azalt (her hunk +- 2 satır)
export function hunksForEdit(
  oldString: string,
  newString: string,
  contextLines = 2,
): DiffLine[] {
  const full = lineDiff(oldString, newString)
  if (full.every((l) => l.kind === "ctx")) return []

  // Çevreleyen ctx'i kısalt: sadece add/del çevresinde N satır göster
  const keep = new Set<number>()
  for (let idx = 0; idx < full.length; idx++) {
    if (full[idx].kind !== "ctx") {
      for (let k = -contextLines; k <= contextLines; k++) {
        const ni = idx + k
        if (ni >= 0 && ni < full.length) keep.add(ni)
      }
    }
  }
  const out: DiffLine[] = []
  let prev = -1
  for (const i of Array.from(keep).sort((x, y) => x - y)) {
    if (prev !== -1 && i - prev > 1) {
      out.push({ kind: "ctx", text: "…" })
    }
    out.push(full[i])
    prev = i
  }
  return out
}
