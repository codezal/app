import { describe, it, expect } from "vitest"
import { parseJsonc, ConfigParseError } from "@/lib/config/parse"

describe("parseJsonc", () => {
  it("düz JSON olduğu gibi parse edilir", () => {
    expect(parseJsonc('{"a":1,"b":"x"}', "test")).toEqual({ a: 1, b: "x" })
  })

  it("satır yorumları kaldırılır", () => {
    const src = `{
      // bu bir yorum
      "key": "value"
    }`
    expect(parseJsonc(src, "test")).toEqual({ key: "value" })
  })

  it("blok yorumları kaldırılır", () => {
    const src = `{ /* blok */ "k": /* araya giren */ 42 }`
    expect(parseJsonc(src, "test")).toEqual({ k: 42 })
  })

  it("çok satırlı blok yorumu kaldırılır, satır numaraları korunur", () => {
    const src = `{
      "x": 1
    }`
    expect(parseJsonc(src, "test")).toEqual({ x: 1 })
  })

  it("nesne sondaki virgül kaldırılır", () => {
    expect(parseJsonc('{"a":1,}', "test")).toEqual({ a: 1 })
  })

  it("dizi sondaki virgül kaldırılır", () => {
    expect(parseJsonc('[1,2,3,]', "test")).toEqual([1, 2, 3])
  })

  it("iç içe sondaki virgüller kaldırılır", () => {
    const src = `{"a":[1,2,],"b":{"c":3,},}`
    expect(parseJsonc(src, "test")).toEqual({ a: [1, 2], b: { c: 3 } })
  })

  it("string içindeki // yorum başlatmaz", () => {
    expect(parseJsonc('{"url":"http://example.com"}', "test")).toEqual({
      url: "http://example.com",
    })
  })

  it("string içindeki /* yorum başlatmaz", () => {
    expect(parseJsonc('{"v":"a /* b */"}', "test")).toEqual({ v: "a /* b */" })
  })

  it("string içindeki ters eğik çizgi escape bozulmaz", () => {
    expect(parseJsonc('{"p":"C:\\\\Users\\\\x"}', "test")).toEqual({
      p: "C:\\Users\\x",
    })
  })

  it("boş nesne parse edilir", () => {
    expect(parseJsonc("{}", "test")).toEqual({})
  })

  it("dizi parse edilir", () => {
    expect(parseJsonc("[1,2,3]", "test")).toEqual([1, 2, 3])
  })

  it("yorum + sondaki virgül birlikte çalışır", () => {
    const src = `{
      // ilk alan
      "a": 1,
      /* ikinci */
      "b": 2,
    }`
    expect(parseJsonc(src, "test")).toEqual({ a: 1, b: 2 })
  })

  it("bozuk JSON → ConfigParseError fırlatır", () => {
    expect(() => parseJsonc("{bad}", "cfg.json")).toThrow(ConfigParseError)
  })

  it("hata mesajı kaynak adını içerir", () => {
    try {
      parseJsonc("{bad}", "myfile.json")
      expect.fail("fırlatmalıydı")
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigParseError)
      expect((e as ConfigParseError).message).toMatch(/myfile\.json/)
      expect((e as ConfigParseError).source).toBe("myfile.json")
    }
  })

  it("hata mesajı JSON parse hatasını içerir", () => {
    try {
      parseJsonc('{\n  "x": bad\n}', "f.json")
      expect.fail("fırlatmalıydı")
    } catch (e) {
      expect((e as ConfigParseError).message).toMatch(/Invalid JSON in f\.json/)
    }
  })

  it("çift tırnak kaçışlı string parse edilir", () => {
    expect(parseJsonc('{"q":"say \\"hi\\""}', "test")).toEqual({ q: 'say "hi"' })
  })
})
