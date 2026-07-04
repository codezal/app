//

export type VimMode = "normal" | "insert"

export type Operator = "d" | "c" | "y"
export type FindType = "f" | "F" | "t" | "T"
export type TextObjScope = "inner" | "around"

export type Pending =
  | { t: "idle" }
  | { t: "count"; digits: string }
  | { t: "op"; op: Operator; count: number }
  | { t: "opCount"; op: Operator; count: number; digits: string }
  | { t: "opFind"; op: Operator; count: number; find: FindType }
  | { t: "opObj"; op: Operator; count: number; scope: TextObjScope }
  | { t: "find"; find: FindType; count: number }
  | { t: "g"; count: number }
  | { t: "opG"; op: Operator; count: number }
  | { t: "replace"; count: number }

export type RecordedChange =
  | { kind: "opMotion"; op: Operator; motion: string; count: number; inserted?: string }
  | { kind: "opObj"; op: Operator; scope: TextObjScope; obj: string; count: number; inserted?: string }
  | { kind: "opLine"; op: Operator; count: number; inserted?: string }
  | { kind: "opFind"; op: Operator; find: FindType; char: string; count: number; inserted?: string }
  | { kind: "x"; count: number }
  | { kind: "replace"; char: string; count: number }
  | { kind: "toggleCase"; count: number }
  | { kind: "paste"; after: boolean; count: number }
  | { kind: "insert"; entry: "i" | "a" | "I" | "A" | "o" | "O"; inserted: string }
  | { kind: "join"; count: number }

export type VimState = {
  mode: VimMode
  pending: Pending
  register: string
  registerLinewise: boolean
  lastChange: RecordedChange | null
  lastFind: { find: FindType; char: string } | null
  insertOrigin: { startOffset: number; change: RecordedChange } | null
}

export type Model = { text: string; cursor: number }

export type KeyOutcome = {
  model: Model
  state: VimState
  handled: boolean
}

export function initialVimState(mode: VimMode = "normal"): VimState {
  return {
    mode,
    pending: { t: "idle" },
    register: "",
    registerLinewise: false,
    lastChange: null,
    lastFind: null,
    insertOrigin: null,
  }
}


function isWordChar(c: string): boolean {
  // CJK Unified (4E00-9FFF), Ext-A (3400-4DBF), Hiragana+Katakana (3040-30FF),
  // Hangul Syllables (AC00-D7AF).
  return /[A-Za-z0-9_぀-ヿ㐀-䶿一-鿿가-힯]/.test(c)
}
function isSpace(c: string): boolean {
  return /\s/.test(c)
}
function wclass(c: string): 0 | 1 | 2 {
  if (isSpace(c)) return 0
  return isWordChar(c) ? 1 : 2
}

function lineStart(text: string, off: number): number {
  const nl = text.lastIndexOf("\n", off - 1)
  return nl + 1
}
function lineEnd(text: string, off: number): number {
  const nl = text.indexOf("\n", off)
  return nl === -1 ? text.length : nl
}
function firstNonBlank(text: string, off: number): number {
  const s = lineStart(text, off)
  const e = lineEnd(text, off)
  let i = s
  while (i < e && isSpace(text[i])) i++
  return i < e ? i : s
}

function clampNormal(text: string, off: number): number {
  if (text.length === 0) return 0
  let c = Math.max(0, Math.min(off, text.length))
  const s = lineStart(text, c)
  const e = lineEnd(text, c)
  if (e > s && c >= e) c = e - 1
  if (c < s) c = s
  return c
}


function nextWordStart(text: string, off: number, big: boolean): number {
  const n = text.length
  let i = off
  if (i >= n) return n
  const startCls = big ? (isSpace(text[i]) ? 0 : 1) : wclass(text[i])
  if (startCls !== 0) {
    while (i < n && !isSpace(text[i]) && (big || wclass(text[i]) === startCls)) i++
  }
  while (i < n && isSpace(text[i])) i++
  return i
}

function prevWordStart(text: string, off: number, big: boolean): number {
  let i = off - 1
  while (i > 0 && isSpace(text[i])) i--
  if (i <= 0) return 0
  const cls = big ? 1 : wclass(text[i])
  while (i > 0 && !isSpace(text[i - 1]) && (big || wclass(text[i - 1]) === cls)) i--
  return Math.max(0, i)
}

function wordEnd(text: string, off: number, big: boolean): number {
  const n = text.length
  let i = off + 1
  while (i < n && isSpace(text[i])) i++
  if (i >= n) return n - 1
  const cls = big ? 1 : wclass(text[i])
  while (i + 1 < n && !isSpace(text[i + 1]) && (big || wclass(text[i + 1]) === cls)) i++
  return i
}


type MotionResult = { target: number; inclusive: boolean; linewise: boolean }

function resolveMotion(
  text: string,
  cursor: number,
  motion: string,
  count: number,
  findChar?: string,
): MotionResult | null {
  const step = (fn: (o: number) => number, o: number): number => {
    let c = o
    for (let i = 0; i < count; i++) c = fn(c)
    return c
  }
  switch (motion) {
    case "h":
      return { target: Math.max(lineStart(text, cursor), cursor - count), inclusive: false, linewise: false }
    case "l":
      return { target: Math.min(lineEnd(text, cursor), cursor + count), inclusive: false, linewise: false }
    case "0":
      return { target: lineStart(text, cursor), inclusive: false, linewise: false }
    case "^":
      return { target: firstNonBlank(text, cursor), inclusive: false, linewise: false }
    case "$": {
      let off = cursor
      for (let i = 1; i < count; i++) off = nextLineSameCol(text, off, 0).off
      return { target: lineEnd(text, off), inclusive: true, linewise: false }
    }
    case "w":
      return { target: step((o) => nextWordStart(text, o, false), cursor), inclusive: false, linewise: false }
    case "W":
      return { target: step((o) => nextWordStart(text, o, true), cursor), inclusive: false, linewise: false }
    case "b":
      return { target: step((o) => prevWordStart(text, o, false), cursor), inclusive: false, linewise: false }
    case "B":
      return { target: step((o) => prevWordStart(text, o, true), cursor), inclusive: false, linewise: false }
    case "e":
      return { target: step((o) => wordEnd(text, o, false), cursor), inclusive: true, linewise: false }
    case "E":
      return { target: step((o) => wordEnd(text, o, true), cursor), inclusive: true, linewise: false }
    case "j":
      return { target: nLines(text, cursor, count), inclusive: false, linewise: true }
    case "k":
      return { target: nLines(text, cursor, -count), inclusive: false, linewise: true }
    case "G":
      return { target: lastLineStart(text), inclusive: false, linewise: true }
    case "gg":
      return { target: 0, inclusive: false, linewise: true }
    case "f":
    case "F":
    case "t":
    case "T": {
      if (!findChar) return null
      const target = findOnLine(text, cursor, motion as FindType, findChar, count)
      if (target === -1) return null
      return { target, inclusive: motion === "f" || motion === "t", linewise: false }
    }
    default:
      return null
  }
}

function nLines(text: string, off: number, delta: number): number {
  const col = off - lineStart(text, off)
  let cur = off
  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      const e = lineEnd(text, cur)
      if (e >= text.length) break
      cur = e + 1
    }
  } else {
    for (let i = 0; i < -delta; i++) {
      const s = lineStart(text, cur)
      if (s === 0) break
      cur = lineStart(text, s - 1)
    }
  }
  const s = lineStart(text, cur)
  const e = lineEnd(text, cur)
  return Math.min(s + col, e)
}

function nextLineSameCol(text: string, off: number, col: number): { off: number } {
  const e = lineEnd(text, off)
  if (e >= text.length) return { off }
  const ns = e + 1
  const ne = lineEnd(text, ns)
  return { off: Math.min(ns + col, ne) }
}

function lastLineStart(text: string): number {
  return lineStart(text, text.length)
}

function findOnLine(
  text: string,
  cursor: number,
  type: FindType,
  ch: string,
  count: number,
): number {
  const s = lineStart(text, cursor)
  const e = lineEnd(text, cursor)
  let pos = cursor
  for (let i = 0; i < count; i++) {
    if (type === "f" || type === "t") {
      let from = pos + 1
      if (type === "t") from = pos + 2
      let idx = -1
      for (let j = Math.min(from, e); j < e; j++) {
        if (text[j] === ch) {
          idx = j
          break
        }
      }
      if (idx === -1) return -1
      pos = type === "t" ? idx - 1 : idx
    } else {
      let from = pos - 1
      if (type === "T") from = pos - 2
      let idx = -1
      for (let j = Math.max(from, s); j >= s; j--) {
        if (text[j] === ch) {
          idx = j
          break
        }
      }
      if (idx === -1) return -1
      pos = type === "T" ? idx + 1 : idx
    }
  }
  return pos
}


const PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"],
  ")": ["(", ")"],
  b: ["(", ")"],
  "{": ["{", "}"],
  "}": ["{", "}"],
  B: ["{", "}"],
  "[": ["[", "]"],
  "]": ["[", "]"],
  "<": ["<", ">"],
  ">": ["<", ">"],
}

function resolveTextObject(
  text: string,
  cursor: number,
  scope: TextObjScope,
  obj: string,
): { start: number; end: number } | null {
  if (obj === "w" || obj === "W") {
    const big = obj === "W"
    const n = text.length
    if (n === 0) return { start: 0, end: 0 }
    const c = Math.min(cursor, n - 1)
    const cls = big ? (isSpace(text[c]) ? 0 : 1) : wclass(text[c])
    const same = (i: number): boolean => {
      if (i < 0 || i >= n || text[i] === "\n") return false
      return (big ? (isSpace(text[i]) ? 0 : 1) : wclass(text[i])) === cls
    }
    let s = c
    let e = c
    while (s > 0 && same(s - 1)) s--
    while (e + 1 < n && same(e + 1)) e++
    let end = e + 1
    if (scope === "around") {
      let ae = end
      while (ae < n && text[ae] !== "\n" && isSpace(text[ae])) ae++
      if (ae > end) end = ae
      else while (s > 0 && text[s - 1] !== "\n" && isSpace(text[s - 1])) s--
    }
    return { start: s, end }
  }
  if (obj === '"' || obj === "'" || obj === "`") {
    return quoteObject(text, cursor, obj, scope)
  }
  const pair = PAIRS[obj]
  if (pair) return pairObject(text, cursor, pair[0], pair[1], scope)
  return null
}

function quoteObject(
  text: string,
  cursor: number,
  q: string,
  scope: TextObjScope,
): { start: number; end: number } | null {
  const s = lineStart(text, cursor)
  const e = lineEnd(text, cursor)
  const positions: number[] = []
  for (let i = s; i < e; i++) if (text[i] === q) positions.push(i)
  if (positions.length < 2) return null
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const open = positions[i]
    const close = positions[i + 1]
    if (cursor <= close) {
      return scope === "inner"
        ? { start: open + 1, end: close }
        : { start: open, end: close + 1 }
    }
  }
  return null
}

function pairObject(
  text: string,
  cursor: number,
  open: string,
  close: string,
  scope: TextObjScope,
): { start: number; end: number } | null {
  let depth = 0
  let openIdx = -1
  for (let i = cursor; i >= 0; i--) {
    if (text[i] === close && i !== cursor) depth++
    else if (text[i] === open) {
      if (depth === 0) {
        openIdx = i
        break
      }
      depth--
    }
  }
  if (openIdx === -1) return null
  depth = 0
  let closeIdx = -1
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      if (depth === 0) {
        closeIdx = i
        break
      }
      depth--
    }
  }
  if (closeIdx === -1) return null
  return scope === "inner"
    ? { start: openIdx + 1, end: closeIdx }
    : { start: openIdx, end: closeIdx + 1 }
}


function applyOpRange(
  model: Model,
  state: VimState,
  op: Operator,
  start: number,
  end: number,
  linewise: boolean,
): { model: Model; state: VimState; enterInsert: boolean } {
  const a = Math.max(0, Math.min(start, end))
  const b = Math.min(model.text.length, Math.max(start, end))
  const slice = model.text.slice(a, b)
  const st: VimState = { ...state, register: slice, registerLinewise: linewise }
  if (op === "y") {
    return {
      model: { text: model.text, cursor: clampNormal(model.text, a) },
      state: st,
      enterInsert: false,
    }
  }
  const newText = model.text.slice(0, a) + model.text.slice(b)
  if (op === "d") {
    return {
      model: { text: newText, cursor: clampNormal(newText, a) },
      state: st,
      enterInsert: false,
    }
  }
  return {
    model: { text: newText, cursor: Math.min(a, newText.length) },
    state: st,
    enterInsert: true,
  }
}

function linewiseRange(text: string, cursor: number, count: number): { start: number; end: number } {
  const start = lineStart(text, cursor)
  let end = start
  for (let i = 0; i < count; i++) {
    const e = lineEnd(text, end)
    end = e < text.length ? e + 1 : e
  }
  return { start, end }
}

function opWithMotion(
  model: Model,
  state: VimState,
  op: Operator,
  motion: string,
  count: number,
  findChar?: string,
): { model: Model; state: VimState; enterInsert: boolean } | null {
  const m = resolveMotion(model.text, model.cursor, motion, count, findChar)
  if (!m) return null
  if (m.linewise) {
    const lo = Math.min(model.cursor, m.target)
    const hi = Math.max(model.cursor, m.target)
    const start = lineStart(model.text, lo)
    let end = lineEnd(model.text, hi)
    end = end < model.text.length ? end + 1 : end
    return applyOpRange(model, state, op, start, end, true)
  }
  const start = Math.min(model.cursor, m.target)
  let end = Math.max(model.cursor, m.target)
  if (m.inclusive) end += 1 // inclusive motion son karakteri kapsar
  return applyOpRange(model, state, op, start, end, false)
}


function insertTextAt(text: string, off: number, s: string): { text: string; cursor: number } {
  return { text: text.slice(0, off) + s + text.slice(off), cursor: off + s.length }
}

// --- Ana reducer ----------------------------------------------------------------

function digitCount(digits: string, fallback = 1): number {
  const n = parseInt(digits || "", 10)
  return isNaN(n) || n < 1 ? fallback : Math.min(n, 100000)
}

function enterInsert(
  model: Model,
  state: VimState,
  change: RecordedChange,
): KeyOutcome {
  return {
    model,
    state: {
      ...state,
      mode: "insert",
      pending: { t: "idle" },
      insertOrigin: { startOffset: model.cursor, change },
    },
    handled: true,
  }
}

const norm = (model: Model, state: VimState): KeyOutcome => ({
  model: { ...model, cursor: clampNormal(model.text, model.cursor) },
  state: { ...state, pending: { t: "idle" } },
  handled: true,
})

export function handleKey(model: Model, state: VimState, key: string): KeyOutcome {
  if (state.mode === "insert") return handleInsert(model, state, key)
  return handleNormal(model, state, key)
}

function handleInsert(model: Model, state: VimState, key: string): KeyOutcome {
  if (key === "Escape") {
    let next: VimState = { ...state }
    const origin = state.insertOrigin
    if (origin) {
      const typed = model.text.slice(origin.startOffset, model.cursor)
      const change: RecordedChange = { ...origin.change, inserted: typed } as RecordedChange
      next = { ...next, lastChange: change }
    }
    next = { ...next, mode: "normal", pending: { t: "idle" }, insertOrigin: null }
    const back = Math.max(lineStart(model.text, model.cursor), model.cursor - 1)
    return { model: { ...model, cursor: clampNormal(model.text, back) }, state: next, handled: true }
  }
  return { model, state, handled: false }
}

function handleNormal(model: Model, state: VimState, key: string): KeyOutcome {
  const p = state.pending

  if (key === "Escape") return norm(model, state)

  // --- pending: count ---
  if (p.t === "count" || p.t === "idle") {
    const digits = p.t === "count" ? p.digits : ""
    if (/[1-9]/.test(key) || (key === "0" && digits !== "")) {
      return {
        model,
        state: { ...state, pending: { t: "count", digits: digits + key } },
        handled: true,
      }
    }
    const count = digitCount(digits)
    return dispatchNormal(model, state, key, count)
  }

  // --- pending: operator ---
  if (p.t === "op" || p.t === "opCount") {
    const digits = p.t === "opCount" ? p.digits : ""
    if (/[1-9]/.test(key) || (key === "0" && digits !== "")) {
      return {
        model,
        state: { ...state, pending: { t: "opCount", op: p.op, count: p.count, digits: digits + key } },
        handled: true,
      }
    }
    const motionCount = p.count * digitCount(digits)
    return dispatchOperatorTarget(model, state, p.op, key, motionCount)
  }

  // --- pending: opFind / find ---
  if (p.t === "opFind") {
    const r = opWithMotion(model, state, p.op, p.find, p.count, key)
    const st: VimState = { ...state, lastFind: { find: p.find, char: key } }
    if (!r) return norm(model, st)
    return finishOp(r, st, { kind: "opFind", op: p.op, find: p.find, char: key, count: p.count })
  }
  if (p.t === "find") {
    const target = findOnLine(model.text, model.cursor, p.find, key, p.count)
    const st: VimState = { ...state, lastFind: { find: p.find, char: key }, pending: { t: "idle" } }
    if (target === -1) return { model, state: st, handled: true }
    return { model: { ...model, cursor: clampNormal(model.text, target) }, state: st, handled: true }
  }

  if (p.t === "opObj") {
    const range = resolveTextObject(model.text, model.cursor, p.scope, key)
    if (!range) return norm(model, state)
    const r = applyOpRange(model, state, p.op, range.start, range.end, false)
    return finishOp(r, state, { kind: "opObj", op: p.op, scope: p.scope, obj: key, count: p.count })
  }

  // --- pending: g ---
  if (p.t === "g") {
    if (key === "g") {
      const target = 0
      return { model: { ...model, cursor: clampNormal(model.text, target) }, state: { ...state, pending: { t: "idle" } }, handled: true }
    }
    return norm(model, state)
  }

  // --- pending: opG (operator + g, beklenen ikinci g → linewise gg) ---
  if (p.t === "opG") {
    if (key === "g") {
      const r = opWithMotion(model, state, p.op, "gg", p.count)
      if (!r) return norm(model, state)
      return finishOp(r, state, { kind: "opMotion", op: p.op, motion: "gg", count: p.count })
    }
    return norm(model, state)
  }

  // --- pending: replace (r{char}) ---
  if (p.t === "replace") {
    if (key.length === 1) {
      const out = doReplace(model, key, p.count)
      return finishSimple(out, state, { kind: "replace", char: key, count: p.count })
    }
    return norm(model, state)
  }

  return norm(model, state)
}

function dispatchNormal(model: Model, state: VimState, key: string, count: number): KeyOutcome {
  if (key === "d" || key === "c" || key === "y") {
    return { model, state: { ...state, pending: { t: "op", op: key as Operator, count } }, handled: true }
  }
  // Motion'lar (cursor hareketi).
  if ("hjkl0^$wWbBeEG".includes(key) && key.length === 1) {
    const m = resolveMotion(model.text, model.cursor, key, count)
    if (m) return { model: { ...model, cursor: clampNormal(model.text, m.target) }, state: { ...state, pending: { t: "idle" } }, handled: true }
  }
  if (key === "g") return { model, state: { ...state, pending: { t: "g", count } }, handled: true }
  // find.
  if (key === "f" || key === "F" || key === "t" || key === "T") {
    return { model, state: { ...state, pending: { t: "find", find: key as FindType, count } }, handled: true }
  }
  if (key === ";" || key === ",") {
    if (!state.lastFind) return norm(model, state)
    let find = state.lastFind.find
    if (key === ",") find = flipFind(find)
    const target = findOnLine(model.text, model.cursor, find, state.lastFind.char, count)
    if (target === -1) return norm(model, state)
    return { model: { ...model, cursor: clampNormal(model.text, target) }, state: { ...state, pending: { t: "idle" } }, handled: true }
  }
  if (key === "i") return enterInsert(model, state, { kind: "insert", entry: "i", inserted: "" })
  if (key === "a") {
    const c = Math.min(model.cursor + 1, lineEnd(model.text, model.cursor))
    return enterInsert({ ...model, cursor: c }, state, { kind: "insert", entry: "a", inserted: "" })
  }
  if (key === "I") {
    return enterInsert({ ...model, cursor: firstNonBlank(model.text, model.cursor) }, state, { kind: "insert", entry: "I", inserted: "" })
  }
  if (key === "A") {
    return enterInsert({ ...model, cursor: lineEnd(model.text, model.cursor) }, state, { kind: "insert", entry: "A", inserted: "" })
  }
  if (key === "o") {
    const e = lineEnd(model.text, model.cursor)
    const ins = insertTextAt(model.text, e, "\n")
    return enterInsert({ text: ins.text, cursor: ins.cursor }, state, { kind: "insert", entry: "o", inserted: "" })
  }
  if (key === "O") {
    const s = lineStart(model.text, model.cursor)
    const ins = insertTextAt(model.text, s, "\n")
    return enterInsert({ text: ins.text, cursor: s }, state, { kind: "insert", entry: "O", inserted: "" })
  }
  if (key === "x") {
    const out = doX(model, count)
    return finishSimple(out, state, { kind: "x", count })
  }
  if (key === "D") {
    const r = applyOpRange(model, state, "d", model.cursor, lineEnd(model.text, model.cursor), false)
    return finishSimple(r.model, r.state, { kind: "opMotion", op: "d", motion: "$", count: 1 })
  }
  if (key === "C") {
    const r = applyOpRange(model, state, "c", model.cursor, lineEnd(model.text, model.cursor), false)
    return enterInsert(r.model, r.state, { kind: "opMotion", op: "c", motion: "$", count: 1, inserted: "" })
  }
  if (key === "Y") {
    const r = applyOpRange(model, state, "y", model.cursor, lineEnd(model.text, model.cursor), false)
    return { model: r.model, state: { ...r.state, pending: { t: "idle" } }, handled: true }
  }
  if (key === "s") {
    // s ~ c+l(count): count karakteri sil + INSERT.
    const end = Math.min(model.cursor + count, lineEnd(model.text, model.cursor))
    const r = applyOpRange(model, state, "c", model.cursor, end, false)
    return enterInsert(r.model, r.state, { kind: "opMotion", op: "c", motion: "l", count, inserted: "" })
  }
  if (key === "S") {
    const r = applyOpRange(model, state, "c", lineStart(model.text, model.cursor), lineEnd(model.text, model.cursor), false)
    return enterInsert(r.model, r.state, { kind: "opLine", op: "c", count, inserted: "" })
  }
  if (key === "r") return { model, state: { ...state, pending: { t: "replace", count } }, handled: true }
  if (key === "~") {
    const out = doToggleCase(model, count)
    return finishSimple(out, state, { kind: "toggleCase", count })
  }
  if (key === "J") {
    const out = doJoin(model, count)
    return finishSimple(out, state, { kind: "join", count })
  }
  if (key === "p" || key === "P") {
    const out = doPaste(model, state, key === "p", count)
    return finishSimple(out, state, { kind: "paste", after: key === "p", count })
  }
  if (key === ".") {
    return repeatLastChange(model, state)
  }
  if (key === "u") {
    return norm(model, state)
  }
  return norm(model, state)
}

function dispatchOperatorTarget(
  model: Model,
  state: VimState,
  op: Operator,
  key: string,
  count: number,
): KeyOutcome {
  // dd / cc / yy → linewise.
  if (key === op) {
    const range = linewiseRange(model.text, model.cursor, count)
    const r = applyOpRange(model, state, op, range.start, range.end, true)
    return finishOp(r, state, { kind: "opLine", op, count })
  }
  if (key === "i" || key === "a") {
    return { model, state: { ...state, pending: { t: "opObj", op, count, scope: key === "i" ? "inner" : "around" } }, handled: true }
  }
  // find motion.
  if (key === "f" || key === "F" || key === "t" || key === "T") {
    return { model, state: { ...state, pending: { t: "opFind", op, count, find: key as FindType } }, handled: true }
  }
  if (key === "g") {
    return { model, state: { ...state, pending: { t: "opG", op, count } }, handled: true }
  }
  // normal motion.
  const r = opWithMotion(model, state, op, key, count)
  if (!r) return norm(model, state)
  return finishOp(r, state, { kind: "opMotion", op, motion: key, count })
}

function finishOp(
  r: { model: Model; state: VimState; enterInsert: boolean },
  _prevState: VimState,
  change: RecordedChange,
): KeyOutcome {
  if (r.enterInsert) {
    return enterInsert(r.model, r.state, change)
  }
  return {
    model: { ...r.model, cursor: clampNormal(r.model.text, r.model.cursor) },
    state: { ...r.state, pending: { t: "idle" }, lastChange: change },
    handled: true,
  }
}

function finishSimple(modelOut: Model, prevState: VimState, change: RecordedChange): KeyOutcome {
  return {
    model: { ...modelOut, cursor: clampNormal(modelOut.text, modelOut.cursor) },
    state: { ...prevState, pending: { t: "idle" }, lastChange: change },
    handled: true,
  }
}


function doX(model: Model, count: number): Model {
  const e = lineEnd(model.text, model.cursor)
  const end = Math.min(model.cursor + count, e)
  if (end <= model.cursor) return model
  const text = model.text.slice(0, model.cursor) + model.text.slice(end)
  return { text, cursor: clampNormal(text, model.cursor) }
}

function doReplace(model: Model, ch: string, count: number): Model {
  const e = lineEnd(model.text, model.cursor)
  const end = Math.min(model.cursor + count, e)
  if (end <= model.cursor) return model
  const repl = ch.repeat(end - model.cursor)
  const text = model.text.slice(0, model.cursor) + repl + model.text.slice(end)
  return { text, cursor: end - 1 }
}

function doToggleCase(model: Model, count: number): Model {
  const e = lineEnd(model.text, model.cursor)
  const end = Math.min(model.cursor + count, e)
  let out = ""
  for (let i = model.cursor; i < end; i++) {
    const c = model.text[i]
    out += c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()
  }
  const text = model.text.slice(0, model.cursor) + out + model.text.slice(end)
  return { text, cursor: clampNormal(text, end) }
}

function doJoin(model: Model, count: number): Model {
  let text = model.text
  let cursor = model.cursor
  const times = Math.max(1, count - 1)
  for (let i = 0; i < times; i++) {
    const e = lineEnd(text, cursor)
    if (e >= text.length) break
    let j = e + 1
    while (j < text.length && (text[j] === " " || text[j] === "\t")) j++
    text = text.slice(0, e) + " " + text.slice(j)
    cursor = e
  }
  return { text, cursor: clampNormal(text, cursor) }
}

function doPaste(model: Model, state: VimState, after: boolean, count: number): Model {
  if (!state.register) return model
  const reg = state.register.repeat(count)
  if (state.registerLinewise) {
    const block = reg.endsWith("\n") ? reg : reg + "\n"
    if (after) {
      const e = lineEnd(model.text, model.cursor)
      if (e < model.text.length) {
        const at = e + 1
        const text = model.text.slice(0, at) + block + model.text.slice(at)
        return { text, cursor: clampNormal(text, at) }
      }
      const text = model.text + "\n" + block.replace(/\n$/, "")
      return { text, cursor: clampNormal(text, model.text.length + 1) }
    }
    const s = lineStart(model.text, model.cursor)
    const text = model.text.slice(0, s) + block + model.text.slice(s)
    return { text, cursor: clampNormal(text, s) }
  }
  // charwise: p → cursor'dan sonra, P → cursor'da.
  const at = after ? Math.min(model.cursor + 1, model.text.length) : model.cursor
  const text = model.text.slice(0, at) + reg + model.text.slice(at)
  return { text, cursor: clampNormal(text, at + reg.length - 1) }
}

// --- Dot-repeat -----------------------------------------------------------------

function flipFind(f: FindType): FindType {
  return f === "f" ? "F" : f === "F" ? "f" : f === "t" ? "T" : "t"
}

function repeatLastChange(model: Model, state: VimState): KeyOutcome {
  const ch = state.lastChange
  if (!ch) return norm(model, state)
  let out: { model: Model; state: VimState; enterInsert: boolean } | null = null
  switch (ch.kind) {
    case "opMotion":
      out = opWithMotion(model, state, ch.op, ch.motion, ch.count)
      break
    case "opObj": {
      const range = resolveTextObject(model.text, model.cursor, ch.scope, ch.obj)
      if (range) out = applyOpRange(model, state, ch.op, range.start, range.end, false)
      break
    }
    case "opLine": {
      const range = linewiseRange(model.text, model.cursor, ch.count)
      out = applyOpRange(model, state, ch.op, range.start, range.end, true)
      break
    }
    case "opFind":
      out = opWithMotion(model, state, ch.op, ch.find, ch.count, ch.char)
      break
    case "x":
      return finishSimple(doX(model, ch.count), state, ch)
    case "replace":
      return finishSimple(doReplace(model, ch.char, ch.count), state, ch)
    case "toggleCase":
      return finishSimple(doToggleCase(model, ch.count), state, ch)
    case "join":
      return finishSimple(doJoin(model, ch.count), state, ch)
    case "paste":
      return finishSimple(doPaste(model, state, ch.after, ch.count), state, ch)
    case "insert": {
      const entered = applyInsertEntry(model, ch.entry)
      const ins = insertTextAt(entered.text, entered.cursor, ch.inserted)
      const text = ins.text
      return {
        model: { text, cursor: clampNormal(text, ins.cursor - 1) },
        state: { ...state, pending: { t: "idle" } },
        handled: true,
      }
    }
  }
  if (!out) return norm(model, state)
  if (out.enterInsert && ch.inserted != null) {
    const ins = insertTextAt(out.model.text, out.model.cursor, ch.inserted)
    const text = ins.text
    return {
      model: { text, cursor: clampNormal(text, ins.cursor - 1) },
      state: { ...out.state, pending: { t: "idle" } },
      handled: true,
    }
  }
  return {
    model: { ...out.model, cursor: clampNormal(out.model.text, out.model.cursor) },
    state: { ...out.state, pending: { t: "idle" } },
    handled: true,
  }
}

function applyInsertEntry(model: Model, entry: "i" | "a" | "I" | "A" | "o" | "O"): Model {
  switch (entry) {
    case "i":
      return model
    case "a":
      return { ...model, cursor: Math.min(model.cursor + 1, lineEnd(model.text, model.cursor)) }
    case "I":
      return { ...model, cursor: firstNonBlank(model.text, model.cursor) }
    case "A":
      return { ...model, cursor: lineEnd(model.text, model.cursor) }
    case "o": {
      const e = lineEnd(model.text, model.cursor)
      const ins = insertTextAt(model.text, e, "\n")
      return ins
    }
    case "O": {
      const s = lineStart(model.text, model.cursor)
      const ins = insertTextAt(model.text, s, "\n")
      return { text: ins.text, cursor: s }
    }
  }
}
