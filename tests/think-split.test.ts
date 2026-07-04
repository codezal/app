import { describe, it, expect } from "vitest"
import { createThinkSplitter } from "@/lib/stream/think-split"

function run(chunks: string[]): { text: string; reasoning: string } {
  let text = ""
  let reasoning = ""
  const s = createThinkSplitter({
    onText: (x) => {
      text += x
    },
    onReasoning: (x) => {
      reasoning += x
    },
  })
  for (const c of chunks) s.feed(c)
  s.flush()
  return { text, reasoning }
}

describe("think-split — tek parça", () => {
  it("baştaki <think> bloğunu reasoning'e, gerisini text'e ayırır", () => {
    expect(run(["<think>düşünüyorum</think>cevap"])).toEqual({
      reasoning: "düşünüyorum",
      text: "cevap",
    })
  })

  it("tag yoksa hepsi text", () => {
    expect(run(["düz cevap"])).toEqual({ reasoning: "", text: "düz cevap" })
  })

  it("think öncesi metin text'e gider", () => {
    expect(run(["önce<think>r</think>sonra"])).toEqual({
      reasoning: "r",
      text: "öncesonra",
    })
  })
})

describe("think-split — interleaved (çoklu blok)", () => {
  it("birden çok think bloğu ile metin sırasını korur", () => {
    expect(run(["<think>A</think>t1<think>B</think>t2"])).toEqual({
      reasoning: "AB",
      text: "t1t2",
    })
  })
})

describe("think-split — chunk sınırında bölünmüş tag", () => {
  it("açılış tag'i iki chunk'a bölünse de yakalar", () => {
    expect(run(["<thi", "nk>gizli</think>açık"])).toEqual({
      reasoning: "gizli",
      text: "açık",
    })
  })

  it("kapanış tag'i bölünse de yakalar", () => {
    expect(run(["<think>r</thi", "nk>cevap"])).toEqual({
      reasoning: "r",
      text: "cevap",
    })
  })

  it("char-char akışta (smoothStream) doğru ayırır", () => {
    const src = "<think>xy</think>ok"
    expect(run([...src])).toEqual({ reasoning: "xy", text: "ok" })
  })
})

describe("think-split — truncation", () => {
  it("yarım kalan açılış tag'i flush'ta görünür metne sızmaz", () => {
    expect(run(["cevap <thi"])).toEqual({ reasoning: "", text: "cevap " })
  })

  it("yarım kalan kapanış tag'i flush'ta reasoning'e sızmaz", () => {
    expect(run(["<think>yarım</thi"])).toEqual({ reasoning: "yarım", text: "" })
  })

  it("kapanmamış think flush'ta reasoning olarak kalır", () => {
    expect(run(["<think>yarım"])).toEqual({ reasoning: "yarım", text: "" })
  })

  it("metindeki yalnız '<' tag değil, text'te kalır", () => {
    expect(run(["a < b"])).toEqual({ reasoning: "", text: "a < b" })
  })
})
