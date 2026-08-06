import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { withLock } from "../lock"

export type NotebookCell = {
  cell_type: string
  source: string | string[]
  id?: string
  metadata?: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
  [k: string]: unknown
}

export type Notebook = {
  cells: NotebookCell[]
  [k: string]: unknown
}

export type CellEditMode = "replace" | "insert" | "delete"

export type CellEditOp = {
  editMode: CellEditMode
  cellNumber?: number
  cellId?: string
  cellType?: "code" | "markdown"
  newSource?: string
}

function toSource(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  return lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l))
}

function makeCell(cellType: "code" | "markdown", source: string, genId?: () => string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    metadata: {},
    source: toSource(source),
  }
  if (genId) cell.id = genId()
  if (cellType === "code") {
    cell.outputs = []
    cell.execution_count = null
  }
  return cell
}

// Returns -1 when not found.
function resolveIndex(cells: NotebookCell[], op: CellEditOp): number {
  if (op.cellId != null) return cells.findIndex((c) => c.id === op.cellId)
  if (op.cellNumber != null) return op.cellNumber
  return -1
}

export function applyCellEdit(nb: Notebook, op: CellEditOp, genId?: () => string): Notebook {
  if (!Array.isArray(nb.cells)) {
    throw new Error("Invalid notebook: missing 'cells' array")
  }
  const cells = [...nb.cells]

  if (op.editMode === "insert") {
    if (!op.cellType) throw new Error("cell_type is required for insert (code|markdown)")
    const newCell = makeCell(op.cellType, op.newSource ?? "", genId)
    let at: number
    if (op.cellId != null) {
      const found = cells.findIndex((c) => c.id === op.cellId)
      at = found === -1 ? 0 : found + 1
    } else {
      at = op.cellNumber ?? 0
    }
    at = Math.max(0, Math.min(at, cells.length))
    cells.splice(at, 0, newCell)
    return { ...nb, cells }
  }

  const idx = resolveIndex(cells, op)
  if (idx < 0 || idx >= cells.length) {
    throw new Error(
      `Cell not found (${op.cellId != null ? `id=${op.cellId}` : `index=${op.cellNumber}`})`,
    )
  }

  if (op.editMode === "delete") {
    cells.splice(idx, 1)
    return { ...nb, cells }
  }

  // replace
  const prev = cells[idx]
  const nextType = op.cellType ?? (prev.cell_type as "code" | "markdown")
  const next: NotebookCell = {
    ...prev,
    cell_type: nextType,
    source: toSource(op.newSource ?? ""),
  }
  if (nextType === "code") {
    if (next.outputs == null) next.outputs = []
    if (next.execution_count === undefined) next.execution_count = null
  } else {
    delete next.outputs
    delete next.execution_count
  }
  cells[idx] = next
  return { ...nb, cells }
}

function newCellId(): string {
  try {
    return globalThis.crypto.randomUUID().slice(0, 8)
  } catch {
    return "c" + Date.now().toString(36)
  }
}

export async function editNotebook(abs: string, op: CellEditOp): Promise<string> {
  // Serialize read-modify-write per file: two concurrent edits (parallel tool
  // calls, multi-session) would otherwise lose one of the updates (LOW
  // notebook.ts:115).
  return withLock(`notebook:${abs}`, async () => {
    const raw = await readTextFile(abs)
    let nb: Notebook
    try {
      nb = JSON.parse(raw) as Notebook
    } catch (e) {
      return `Invalid .ipynb (JSON parse error): ${e instanceof Error ? e.message : String(e)}`
    }
    const next = applyCellEdit(nb, op, newCellId)
    await writeTextFile(abs, JSON.stringify(next, null, 1) + "\n")
    const verb =
      op.editMode === "insert" ? "inserted" : op.editMode === "delete" ? "deleted" : "updated"
    return `Notebook cell ${verb}: ${abs} (${next.cells.length} cells)`
  })
}
