import { describe, it, expect } from "vitest"
import { applyCellEdit, type Notebook } from "@/lib/tools/notebook"

const fixedId = () => "testid01"

function nb(cells: Notebook["cells"]): Notebook {
  return { cells, nbformat: 4, nbformat_minor: 5, metadata: {} }
}

describe("applyCellEdit", () => {
  it("replace: hücre kaynağını günceller, diğer alanları korur", () => {
    const src = nb([
      { cell_type: "code", source: ["print(1)"], id: "a", outputs: [], execution_count: 1 },
    ])
    const out = applyCellEdit(src, { editMode: "replace", cellNumber: 0, newSource: "print(2)" })
    expect(out.cells[0].source).toEqual(["print(2)"])
    expect(out.cells[0].id).toBe("a")
    expect(out.cells[0].outputs).toEqual([])
    expect(src.cells[0].source).toEqual(["print(1)"])
  })

  it("replace: çok satırlı kaynağı nbformat satır listesine böler", () => {
    const src = nb([{ cell_type: "markdown", source: ["x"] }])
    const out = applyCellEdit(src, { editMode: "replace", cellNumber: 0, newSource: "a\nb\nc" })
    expect(out.cells[0].source).toEqual(["a\n", "b\n", "c"])
  })

  it("replace: cell_type code→markdown geçişinde code alanlarını düşürür", () => {
    const src = nb([
      { cell_type: "code", source: ["1"], outputs: [{ x: 1 }], execution_count: 3 },
    ])
    const out = applyCellEdit(src, {
      editMode: "replace",
      cellNumber: 0,
      cellType: "markdown",
      newSource: "# title",
    })
    expect(out.cells[0].cell_type).toBe("markdown")
    expect(out.cells[0].outputs).toBeUndefined()
    expect(out.cells[0].execution_count).toBeUndefined()
  })

  it("replace: cellId ile hedefler (cellNumber'a üstün)", () => {
    const src = nb([
      { cell_type: "code", source: ["a"], id: "x" },
      { cell_type: "code", source: ["b"], id: "y" },
    ])
    const out = applyCellEdit(src, { editMode: "replace", cellId: "y", newSource: "B" })
    expect(out.cells[1].source).toEqual(["B"])
    expect(out.cells[0].source).toEqual(["a"])
  })

  it("insert: cell_number indeksine yeni hücre ekler, id üretir", () => {
    const src = nb([{ cell_type: "code", source: ["a"] }])
    const out = applyCellEdit(
      src,
      { editMode: "insert", cellNumber: 0, cellType: "markdown", newSource: "# top" },
      fixedId,
    )
    expect(out.cells.length).toBe(2)
    expect(out.cells[0].cell_type).toBe("markdown")
    expect(out.cells[0].source).toEqual(["# top"])
    expect(out.cells[0].id).toBe("testid01")
  })

  it("insert: cellId verilince o hücreden sonra ekler", () => {
    const src = nb([
      { cell_type: "code", source: ["a"], id: "a" },
      { cell_type: "code", source: ["b"], id: "b" },
    ])
    const out = applyCellEdit(
      src,
      { editMode: "insert", cellId: "a", cellType: "code", newSource: "mid" },
      fixedId,
    )
    expect(out.cells.map((c) => c.source)).toEqual([["a"], ["mid"], ["b"]])
  })

  it("insert: code hücresine outputs/execution_count ekler", () => {
    const src = nb([])
    const out = applyCellEdit(
      src,
      { editMode: "insert", cellType: "code", newSource: "x = 1" },
      fixedId,
    )
    expect(out.cells[0].outputs).toEqual([])
    expect(out.cells[0].execution_count).toBeNull()
  })

  it("insert: cell_type yoksa hata fırlatır", () => {
    expect(() =>
      applyCellEdit(nb([]), { editMode: "insert", newSource: "x" }),
    ).toThrow(/cell_type/)
  })

  it("delete: hedef hücreyi siler", () => {
    const src = nb([
      { cell_type: "code", source: ["a"] },
      { cell_type: "code", source: ["b"] },
    ])
    const out = applyCellEdit(src, { editMode: "delete", cellNumber: 0 })
    expect(out.cells.length).toBe(1)
    expect(out.cells[0].source).toEqual(["b"])
  })

  it("replace/delete: bulunamayan hücre hata fırlatır", () => {
    expect(() =>
      applyCellEdit(nb([]), { editMode: "replace", cellNumber: 5, newSource: "x" }),
    ).toThrow(/bulunamadı/)
    expect(() =>
      applyCellEdit(nb([{ cell_type: "code", source: ["a"] }]), {
        editMode: "delete",
        cellId: "nope",
      }),
    ).toThrow(/bulunamadı/)
  })

  it("boş kaynak boş satır listesine çevrilir", () => {
    const src = nb([{ cell_type: "code", source: ["a"] }])
    const out = applyCellEdit(src, { editMode: "replace", cellNumber: 0, newSource: "" })
    expect(out.cells[0].source).toEqual([])
  })
})
