import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight, Undo2 } from "@/lib/icons"
import { FileTypeIcon } from "@/lib/file-icons"
import { cn } from "@/lib/utils"

type ParsedLine = {
  kind: "add" | "del" | "ctx" | "hunk"
  text: string
  oldNo: number | null
  newNo: number | null
}

type ParsedFile = {
  header: string
  path: string
  additions: number
  deletions: number
  hunks: ParsedLine[][]
}

function parseUnifiedDiff(text: string): ParsedFile[] {
  const lines = text.split("\n")
  const files: ParsedFile[] = []
  let current: ParsedFile | null = null
  let hunkLines: ParsedLine[] = []
  let oldNo = 0
  let newNo = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith("diff --git")) {
      if (current) {
        if (hunkLines.length) current.hunks.push(hunkLines)
        files.push(current)
      }
      const pathMatch = line.match(/b\/(.+)$/)
      current = {
        header: line,
        path: pathMatch?.[1] ?? line,
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      hunkLines = []
      continue
    }

    if (!current) {
      if (!files.length && (line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
        current = {
          header: "",
          path: "",
          additions: 0,
          deletions: 0,
          hunks: [],
        }
      } else {
        continue
      }
    }

    if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue
    }

    if (line.startsWith("@@")) {
      if (hunkLines.length) current.hunks.push(hunkLines)
      hunkLines = []
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      oldNo = match ? parseInt(match[1], 10) : 1
      newNo = match ? parseInt(match[2], 10) : 1
      hunkLines.push({ kind: "hunk", text: line, oldNo: null, newNo: null })
      continue
    }

    if (line.startsWith("+")) {
      current.additions++
      hunkLines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ })
    } else if (line.startsWith("-")) {
      current.deletions++
      hunkLines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null })
    } else if (line.startsWith(" ") || line === "") {
      hunkLines.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, oldNo: oldNo++, newNo: newNo++ })
    }
  }

  if (current) {
    if (hunkLines.length) current.hunks.push(hunkLines)
    files.push(current)
  }

  return files
}

function groupContextLines(hunkLines: ParsedLine[], threshold = 8): (ParsedLine | { kind: "fold"; count: number })[] {
  const result: (ParsedLine | { kind: "fold"; count: number })[] = []
  let ctxRun: ParsedLine[] = []

  const flush = () => {
    if (ctxRun.length <= threshold) {
      result.push(...ctxRun)
    } else {
      result.push(...ctxRun.slice(0, 3))
      result.push({ kind: "fold", count: ctxRun.length - 6 })
      result.push(...ctxRun.slice(-3))
    }
    ctxRun = []
  }

  for (const line of hunkLines) {
    if (line.kind === "ctx") {
      ctxRun.push(line)
    } else {
      if (ctxRun.length) flush()
      result.push(line)
    }
  }
  if (ctxRun.length) flush()

  return result
}

type DiffFileHeaderProps = {
  path: string
  additions: number
  deletions: number
  open: boolean
  onToggle: () => void
  onRevert?: () => void
  revertTitle?: string
}

export function DiffFileHeader({
  path,
  additions,
  deletions,
  open,
  onToggle,
  onRevert,
  revertTitle,
}: DiffFileHeaderProps) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path

  return (
    <div className="flex min-h-10 items-center border-b border-codezal bg-codezal-panel">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-codezal-panel-2"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
        )}
        <FileTypeIcon name={name} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate font-mono text-[13px]">
          <span className="font-semibold text-codezal-text">{name}</span>
          {dir && <span className="ml-2 text-codezal-mute">{dir}</span>}
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-1.5 px-2 font-mono text-xs">
        {additions > 0 && <span className="text-codezal-diff-add">+{additions}</span>}
        {deletions > 0 && <span className="text-codezal-diff-del">-{deletions}</span>}
      </span>

      {onRevert && (
        <button
          type="button"
          onClick={onRevert}
          title={revertTitle}
          className="mr-2 rounded p-1 text-codezal-mute transition-colors hover:bg-codezal-bg hover:text-codezal-text"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function FileSection({
  file,
  defaultOpen = true,
  onRevert,
  revertTitle,
}: {
  file: ParsedFile
  defaultOpen?: boolean
  onRevert?: () => void
  revertTitle?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-codezal last:border-b-0 [contain-intrinsic-size:400px] [content-visibility:auto]">
      <DiffFileHeader
        path={file.path}
        additions={file.additions}
        deletions={file.deletions}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        onRevert={onRevert}
        revertTitle={revertTitle}
      />

      {open && (
        <div className="overflow-x-auto bg-codezal-code">
          <table className="w-full border-collapse font-mono text-[13px] leading-[1.55]">
            <tbody>
              {file.hunks.map((hunk, hi) =>
                groupContextLines(hunk).map((item, li) => {
                  if ("count" in item && item.kind === "fold") {
                    return (
                      <tr key={`${hi}-fold-${li}`}>
                        <td
                          colSpan={4}
                          className="border-y border-codezal bg-codezal-panel px-3 py-1 text-center text-xs text-codezal-mute"
                        >
                          {item.count} unmodified lines
                        </td>
                      </tr>
                    )
                  }

                  const line = item as ParsedLine

                  if (line.kind === "hunk") {
                    return (
                      <tr key={`${hi}-hunk-${li}`}>
                        <td
                          colSpan={4}
                          className="border-t border-codezal bg-codezal-panel px-3 py-1 text-xs text-codezal-mute"
                        >
                          {line.text}
                        </td>
                      </tr>
                    )
                  }

                  const rowBg =
                    line.kind === "add"
                      ? "bg-codezal-diff-add"
                      : line.kind === "del"
                        ? "bg-codezal-diff-del"
                        : ""

                  const textCls =
                    line.kind === "add"
                      ? "text-codezal-diff-add"
                      : line.kind === "del"
                        ? "text-codezal-diff-del"
                        : "text-codezal-text"

                  return (
                    <tr
                      key={`${hi}-${li}`}
                      className={rowBg}
                      data-diff-row={line.kind === "add" ? "add" : line.kind === "del" ? "del" : undefined}
                    >
                      <td className="w-10 select-none whitespace-nowrap border-r border-codezal-hair px-2 text-right text-codezal-mute">
                        {line.oldNo ?? ""}
                      </td>
                      <td className="w-10 select-none whitespace-nowrap border-r border-codezal-hair px-2 text-right text-codezal-mute">
                        {line.newNo ?? ""}
                      </td>
                      <td className={cn("w-5 select-none text-center", textCls)}>
                        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                      </td>
                      <td className={cn("whitespace-pre pr-4", textCls)}>
                        {line.text || " "}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function DiffView({
  text,
  defaultOpen = true,
  onRevertFile,
  revertTitle,
}: {
  text: string
  defaultOpen?: boolean
  onRevertFile?: (path: string) => void
  revertTitle?: string
}) {
  const files = useMemo(() => parseUnifiedDiff(text), [text])

  if (!files.length) {
    return (
      <pre className="overflow-x-auto p-3 font-mono text-sm leading-[1.5] text-codezal-mute">
        {text}
      </pre>
    )
  }

  return (
    <div>
      {files.map((file, i) => (
        <FileSection
          key={`${file.path}-${i}`}
          file={file}
          defaultOpen={defaultOpen}
          onRevert={onRevertFile ? () => onRevertFile(file.path) : undefined}
          revertTitle={revertTitle}
        />
      ))}
    </div>
  )
}
