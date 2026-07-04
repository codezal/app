import { describe, it, expect } from "vitest"
import { handleKey, initialVimState, type Model, type VimState } from "@/lib/vim/engine"

type Snap = { text: string; cursor: number; mode: VimState["mode"] }

function parse(s: string): Model {
  const cursor = s.indexOf("|")
  return { text: s.replace("|", ""), cursor: cursor < 0 ? 0 : cursor }
}

function drive(start: string, keys: string[]): Snap {
  let model = parse(start)
  let state = initialVimState("normal")
  for (const k of keys) {
    const out = handleKey(model, state, k)
    model = out.model
    state = out.state
    if (!out.handled && state.mode === "insert" && k.length === 1) {
      model = {
        text: model.text.slice(0, model.cursor) + k + model.text.slice(model.cursor),
        cursor: model.cursor + 1,
      }
    }
  }
  return { text: model.text, cursor: model.cursor, mode: state.mode }
}

describe("motions", () => {
  it("h/l satır içi hareket", () => {
    expect(drive("a|bc", ["l"]).cursor).toBe(2)
    expect(drive("ab|c", ["h"]).cursor).toBe(1)
  })
  it("w/b/e kelime hareketi", () => {
    expect(drive("|foo bar", ["w"]).cursor).toBe(4)
    expect(drive("foo |bar", ["b"]).cursor).toBe(0)
    expect(drive("|foo bar", ["e"]).cursor).toBe(2)
  })
  it("0/$ satır başı/sonu", () => {
    expect(drive("foo |bar", ["0"]).cursor).toBe(0)
    expect(drive("|foo bar", ["$"]).cursor).toBe(6)
  })
  it("j/k mantıksal satır + sütun koru", () => {
    expect(drive("ab|c\ndef", ["j"]).cursor).toBe(6) // 'f'
    expect(drive("abc\nde|f", ["k"]).cursor).toBe(2)
  })
})

describe("tek-tuş edit", () => {
  it("x karakter sil", () => {
    expect(drive("|abc", ["x"]).text).toBe("bc")
    expect(drive("|abcde", ["3", "x"]).text).toBe("de")
  })
  it("r karakter değiştir", () => {
    expect(drive("|abc", ["r", "X"]).text).toBe("Xbc")
  })
  it("~ büyük/küçük çevir", () => {
    expect(drive("|abc", ["~"]).text).toBe("Abc")
  })
  it("J satır birleştir", () => {
    expect(drive("|foo\nbar", ["J"]).text).toBe("foo bar")
  })
  it("D satır sonuna kadar sil", () => {
    expect(drive("foo |bar", ["D"]).text).toBe("foo ")
  })
})

describe("operatör + motion", () => {
  it("dw kelime sil", () => {
    expect(drive("|foo bar", ["d", "w"]).text).toBe("bar")
  })
  it("d2w sayımlı sil", () => {
    expect(drive("|a b c d", ["d", "2", "w"]).text).toBe("c d")
  })
  it("dd satır sil", () => {
    expect(drive("|a\nb\nc", ["d", "d"]).text).toBe("b\nc")
    expect(drive("|a\nb\nc", ["2", "d", "d"]).text).toBe("c")
  })
  it("d$ satır sonuna kadar", () => {
    expect(drive("foo |bar", ["d", "$"]).text).toBe("foo ")
  })
  it("yy + p satır yapıştır", () => {
    expect(drive("|a\nb", ["y", "y", "p"]).text).toBe("a\na\nb")
  })
})

describe("text objects", () => {
  it("diw iç kelime sil", () => {
    expect(drive("foo |bar baz", ["d", "i", "w"]).text).toBe("foo  baz")
  })
  it("di( iç parantez sil", () => {
    expect(drive("a(b|c)d", ["d", "i", "("]).text).toBe("a()d")
  })
  it('ci" iç tırnak değiştir', () => {
    expect(drive('x="a|b"', ["c", "i", '"', "Y"]).text).toBe('x="Y"')
  })
  it("da( around parantez sil", () => {
    expect(drive("a(b|c)d", ["d", "a", "("]).text).toBe("ad")
  })
})

describe("insert giriş", () => {
  it("i + yaz + Esc", () => {
    const s = drive("|bc", ["i", "a", "Escape"])
    expect(s.text).toBe("abc")
    expect(s.mode).toBe("normal")
  })
  it("A satır sonuna ekle", () => {
    expect(drive("|ab", ["A", "X", "Escape"]).text).toBe("abX")
  })
  it("o alt satır aç", () => {
    expect(drive("|ab", ["o", "x", "Escape"]).text).toBe("ab\nx")
  })
  it("O üst satır aç", () => {
    expect(drive("|ab", ["O", "x", "Escape"]).text).toBe("x\nab")
  })
  it("ciw değiştir", () => {
    expect(drive("|foo bar", ["c", "i", "w", "Z", "Escape"]).text).toBe("Z bar")
  })
})

describe("find", () => {
  it("f char'a git", () => {
    expect(drive("|abcdef", ["f", "d"]).cursor).toBe(3)
  })
  it("t char öncesine", () => {
    expect(drive("|abcdef", ["t", "d"]).cursor).toBe(2)
  })
  it("dfx inclusive sil", () => {
    expect(drive("|abcdef", ["d", "f", "c"]).text).toBe("def")
  })
})

describe("dot-repeat", () => {
  it(". x tekrarı", () => {
    expect(drive("|abcd", ["x", "."]).text).toBe("cd")
  })
  it(". dw tekrarı", () => {
    expect(drive("|a b c", ["d", "w", "."]).text).toBe("c")
  })
  it(". ciw tekrarı başka kelimede", () => {
    // foo→Z, sonraki kelimeye git, . → bar→Z
    expect(drive("|foo bar", ["c", "i", "w", "Z", "Escape", "w", "."]).text).toBe("Z Z")
  })
})
