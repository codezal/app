import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight } from "@/lib/icons"
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

function FileSection({ file, defaultOpen = true }: { file: ParsedFile; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : ""
  const name = file.path.includes("/") ? file.path.slice(file.path.lastIndexOf("/") + 1) : file.path

  return (
    <div className="border-b border-codezal last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-codezal-panel"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
        )}
        <span className="truncate font-mono text-sm">
          <span className="font-semibold text-codezal-text">{name}</span>
          {dir && <span className="ml-1.5 text-codezal-mute">{dir}</span>}
        </span>
        <span className="ml-auto shrink-0 font-mono text-sm">
          {file.additions > 0 && (
            <span className="text-codezal-diff-add">+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && <span className="text-codezal-mute"> </span>}
          {file.deletions > 0 && (
            <span className="text-codezal-diff-del">-{file.deletions}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-sm leading-[1.6]">
            <tbody>
              {file.hunks.map((hunk, hi) =>
                groupContextLines(hunk).map((item, li) => {
                  if ("count" in item && item.kind === "fold") {
                    return (
                      <tr key={`${hi}-fold-${li}`}>
                        <td
                          colSpan={2}
                          className="border-y border-codezal bg-codezal-panel px-3 py-1 text-center text-codezal-mute"
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
                          colSpan={2}
                          className="border-t border-codezal bg-codezal-panel px-3 py-0.5 text-codezal-accent"
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

                  const lineNo =
                    line.kind === "del"
                      ? line.oldNo
                      : line.kind === "add"
                        ? line.newNo
                        : (line.newNo ?? line.oldNo)

                  return (
                    <tr
                      key={`${hi}-${li}`}
                      className={rowBg}
                      data-diff-row={line.kind === "add" ? "add" : line.kind === "del" ? "del" : undefined}
                    >
                      <td className="w-[1px] select-none whitespace-nowrap border-r border-codezal-hair px-2 text-right text-codezal-mute">
                        {lineNo ?? ""}
                      </td>
                      <td className={cn("whitespace-pre px-3", textCls)}>
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

export function DiffView({ text, defaultOpen = true }: { text: string; defaultOpen?: boolean }) {
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
        <FileSection key={`${file.path}-${i}`} file={file} defaultOpen={defaultOpen} />
      ))}
    </div>
  )
}
