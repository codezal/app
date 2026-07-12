//
//
import { useEffect, useMemo, useState } from "react"
import { useSessionsStore } from "@/store/sessions"
import { toast } from "@/store/toast"
import { useWriteDiffs } from "@/store/write-diffs"
import { aggregateTurnEdits, turnEditsToUnifiedDiff } from "@/lib/turn-edits"
import { parseTurnDiffUri } from "@/lib/turn-diff-uri"
import { DiffFileHeader, DiffView } from "./DiffView"
import { CodeView } from "./CodeView"
import { useT } from "@/lib/i18n/useT"
import { File, Undo2, X } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { splitHunks } from "@/lib/hunk-revert"
import type { DiffLine } from "@/lib/diff"

export function TurnDiffViewer({ uri }: { uri: string }) {
  const t = useT()
  const parsed = parseTurnDiffUri(uri)
  const messageId = parsed?.messageId ?? null
  const focusPath = parsed?.focusPath ?? null
  const message = useSessionsStore((s) =>
    messageId ? (s.active?.messages.find((m) => m.id === messageId) ?? null) : null,
  )
  const writeOld = useWriteDiffs((s) => s.byCallId)
  const closeFile = useSessionsStore((s) => s.closeFile)
  const revertToBeforeMessage = useSessionsStore((s) => s.revertToBeforeMessage)
  const revertTurnFile = useSessionsStore((s) => s.revertTurnFile)
  const [reverted, setReverted] = useState<ReadonlySet<string>>(() => new Set())
  const edits = useMemo(() => aggregateTurnEdits(message?.parts, writeOld), [message?.parts, writeOld])
  const perFile = useMemo(
    () =>
      edits.files.map((f) => ({
        file: f,
        text: turnEditsToUnifiedDiff({ files: [f], totalAdded: f.added, totalRemoved: f.removed }),
      })),
    [edits],
  )

  const matched = focusPath ? perFile.filter((x) => x.file.path === focusPath) : []
  const single = matched.length > 0
  const shown = single ? matched : perFile
  const shownAdded = shown.reduce((s, x) => s + x.file.added, 0)
  const shownRemoved = shown.reduce((s, x) => s + x.file.removed, 0)
  const canRevert = !!message?.snapshotBase

  async function handleRevert() {
    if (!messageId || !canRevert) return
    if (!window.confirm(t("app.revertConfirm"))) return
    try {
      await revertToBeforeMessage(messageId)
    } catch {
      // Intentionally ignored.
    }
    closeFile(uri)
  }

  async function handleRevertFile(path: string) {
    if (!messageId || !canRevert) return
    if (!window.confirm(t("messageList.fileRevertConfirm"))) return
    const ok = await revertTurnFile(messageId, path)
    if (ok) setReverted((prev) => new Set(prev).add(path))
    else toast.error(t("app.revertFailed", { message: path }))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b border-codezal bg-codezal-bg px-3 text-sm">
        <File className="h-4 w-4 shrink-0 text-codezal-mute" />
        <span className="min-w-0 truncate font-medium text-codezal-text">
          {t("messageList.turnEditsSummary", { count: shown.length })}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
          {shownAdded > 0 && <span className="text-codezal-diff-add">+{shownAdded}</span>}
          {shownRemoved > 0 && <span className="text-codezal-diff-del">-{shownRemoved}</span>}
        </span>
        <div className="flex-1" />
        {canRevert && (
          <button
            type="button"
            onClick={handleRevert}
            title={t("messageList.turnRevert")}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-codezal bg-codezal-panel px-2.5 py-1 text-xs text-codezal-dim transition-colors hover:border-codezal-strong hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <Undo2 className="h-3.5 w-3.5" /> {t("messageList.turnRevert")}
          </button>
        )}
        <button
          type="button"
          onClick={() => closeFile(uri)}
          title={t("common.close")}
          className="shrink-0 rounded-md p-1.5 text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-codezal-code">
        {edits.files.length === 0 ? (
          <div className="p-6 text-md text-codezal-mute">{t("messageList.noChanges")}</div>
        ) : single &&
          canRevert &&
          messageId &&
          shown[0].file.lines.length > 0 &&
          !shown[0].file.path.includes(" → ") ? (
          <HunkReview
            messageId={messageId}
            path={shown[0].file.path}
            additions={shown[0].file.added}
            deletions={shown[0].file.removed}
            onRevertFile={() => void handleRevertFile(shown[0].file.path)}
          />
        ) : (
          shown.map(({ file, text }) => {
            if (reverted.has(file.path)) {
              return (
                <div
                  key={file.path}
                  className="flex items-center gap-2 border-b border-codezal px-3 py-1.5 text-sm text-codezal-mute"
                >
                  <Undo2 className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate line-through">{file.path}</span>
                  <span className="shrink-0">· {t("messageList.fileReverted")}</span>
                </div>
              )
            }
            const isRename = file.path.includes(" → ")
            return (
              <div key={file.path}>
                {file.lines.length === 0 && file.newContent != null ? (
                  <CodeView code={file.newContent} path={file.path} accent="add" />
                ) : (
                  <DiffView
                    text={text}
                    onRevertFile={
                      canRevert && !isRename ? () => void handleRevertFile(file.path) : undefined
                    }
                    revertTitle={t("messageList.fileRevert")}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function HunkReview({
  messageId,
  path,
  additions,
  deletions,
  onRevertFile,
}: {
  messageId: string
  path: string
  additions: number
  deletions: number
  onRevertFile: () => void
}) {
  const t = useT()
  const turnFileDiff = useSessionsStore((s) => s.turnFileDiff)
  const revertTurnHunk = useSessionsStore((s) => s.revertTurnHunk)
  const [lines, setLines] = useState<DiffLine[] | null | undefined>(undefined)
  const [reloadKey, setReloadKey] = useState(0)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let alive = true
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLines(undefined)
    void turnFileDiff(messageId, path).then((l) => {
      if (alive) setLines(l)
    })
    return () => {
      alive = false
    }
  }, [messageId, path, reloadKey, turnFileDiff])

  if (lines === undefined) {
    return <div className="p-4 text-sm text-codezal-mute">{t("prPanel.loading")}</div>
  }
  if (lines === null || lines.every((l) => l.kind === "ctx")) {
    return <div className="p-4 text-sm text-codezal-mute">{t("messageList.noChanges")}</div>
  }
  const hunks = splitHunks(lines)

  return (
    <div className="flex flex-col">
      <DiffFileHeader
        path={path}
        additions={additions}
        deletions={deletions}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        onRevert={onRevertFile}
        revertTitle={t("messageList.fileRevert")}
      />
      {open &&
        hunks.map((h) => (
          <div key={h.index} className="border-b border-codezal">
            <div className="flex items-center justify-end bg-codezal-panel px-3 py-1">
              <button
                type="button"
                onClick={() =>
                  void revertTurnHunk(messageId, path, h.index).then((ok) => {
                    if (ok) setReloadKey((k) => k + 1)
                  })
                }
                title={t("messageList.hunkRevert")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-codezal-mute transition-colors hover:bg-codezal-bg hover:text-codezal-text"
              >
                <Undo2 className="h-3 w-3" /> {t("messageList.hunkRevert")}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[13px] leading-[1.55]">
                <tbody>
                  {h.display.map((line, index) => {
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
                      <tr key={index} className={rowBg}>
                        <td className="w-10 select-none whitespace-nowrap border-r border-codezal-hair px-2 text-right text-codezal-mute">
                          {line.oldNo ?? ""}
                        </td>
                        <td className="w-10 select-none whitespace-nowrap border-r border-codezal-hair px-2 text-right text-codezal-mute">
                          {line.newNo ?? ""}
                        </td>
                        <td className={cn("w-5 select-none text-center", textCls)}>
                          {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                        </td>
                        <td className={cn("whitespace-pre pr-4", textCls)}>{line.text || " "}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  )
}
