import { describe, it, expect } from "vitest"
import { zipSync, strToU8 } from "fflate"
import {
  csvToMarkdown,
  parseDelimited,
  xlsxToMarkdown,
  pptxToMarkdown,
  docxToMarkdown,
  isBinaryDoc,
  isOfficeDoc,
  docFormat,
  extractBinaryDoc,
} from "../src/lib/documents"

function zip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v)
  return zipSync(entries)
}

describe("csv adapter", () => {
  it("RFC4180 quote/escape + gömülü virgül", () => {
    const grid = parseDelimited('a,b\n"x,y","z""q"')
    expect(grid).toEqual([
      ["a", "b"],
      ["x,y", 'z"q'],
    ])
  })

  it("TSV ayracını sezer", () => {
    expect(parseDelimited("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("markdown tablo üretir (başlık + ayraç satırı)", () => {
    const md = csvToMarkdown("name,age\nali,30")
    expect(md).toContain("| name | age |")
    expect(md).toContain("| --- | --- |")
    expect(md).toContain("| ali | 30 |")
  })

  it("hücre içi boruyu kaçışlar", () => {
    expect(csvToMarkdown("a\nx|y")).toContain("x\\|y")
  })
})

describe("xlsx adapter", () => {
  const xlsx = zip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Veri" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/sharedStrings.xml":
      '<sst><si><t>Ad</t></si><si><t>Yaş</t></si><si><t>Ali</t></si></sst>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c></row>' +
      "</sheetData></worksheet>",
  })

  it("sharedStrings + sayısal hücreleri çözer, sayfa adını kullanır", () => {
    const md = xlsxToMarkdown(xlsx)
    expect(md).toContain("## Veri")
    expect(md).toContain("| Ad | Yaş |")
    expect(md).toContain("| Ali | 30 |")
  })

  it("inlineStr hücresini okur", () => {
    const z = zip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Merhaba</t></is></c></row></sheetData></worksheet>',
    })
    expect(xlsxToMarkdown(z)).toContain("Merhaba")
  })
})

describe("pptx adapter", () => {
  it("slayt başına metni sırayla çıkarır", () => {
    const z = zip({
      "ppt/slides/slide1.xml": "<p:sld><a:t>Başlık</a:t><a:t>alt</a:t></p:sld>",
      "ppt/slides/slide2.xml": "<p:sld><a:t>İkinci</a:t></p:sld>",
    })
    const md = pptxToMarkdown(z)
    expect(md).toContain("## Slide 1")
    expect(md).toContain("Başlık")
    expect(md).toContain("## Slide 2")
    expect(md).toContain("İkinci")
  })
})

describe("docx adapter", () => {
  it("paragrafları metne çevirir + entity decode", () => {
    const z = zip({
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>Bir &amp; iki</w:t></w:r></w:p><w:p><w:r><w:t>satır2</w:t></w:r></w:p></w:body></w:document>",
    })
    const md = docxToMarkdown(z)
    expect(md).toContain("Bir & iki")
    expect(md).toContain("satır2")
  })
})

describe("registry", () => {
  it("uzantı tespiti", () => {
    expect(isBinaryDoc("a.xlsx")).toBe(true)
    expect(isBinaryDoc("a.csv")).toBe(false)
    expect(isOfficeDoc("a.csv")).toBe(true)
    expect(isOfficeDoc("a.txt")).toBe(false)
    expect(docFormat("x.PPTX")).toBe("pptx")
  })

  it("bozuk binary → throw etmez, hata string'i döner", () => {
    const out = extractBinaryDoc(new Uint8Array([1, 2, 3]), "bozuk.xlsx")
    expect(out).toContain("ayrıştırılamadı")
  })
})
