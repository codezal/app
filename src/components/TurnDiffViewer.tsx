//
//
import { useEffect, useMemo, useState } from "react"
import { useSessionsStore } from "@/store/sessions"
import { toast } from "@/store/toast"
import { useWriteDiffs } from "@/store/write-diffs"
import { aggregateTurnEdits, turnEditsToUnifiedDiff } from "@/lib/turn-edits"
import { parseTurnDiffUri } from "@/lib/turn-diff-uri"
import { DiffView } from "./DiffView"
import { CodeView } from "./CodeView"
import { useT } from "@/lib/i18n/useT"
import { Undo2, X } from "@/lib/icons"
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
      <div className="flex items-center gap-2 border-b border-codezal px-3 py-2 text-md">
        <span className="min-w-0 truncate font-medium text-codezal-text">
          {single ? shown[0]?.file.path : t("messageList.turnEditsSummary", { count: shown.length })}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono">
          {shownAdded > 0 && <span className="text-codezal-diff-add">+{shownAdded}</span>}
          {shownRemoved > 0 && <span className="text-codezal-diff-del">-{shownRemoved}</span>}
        </span>
        <div className="flex-1" />
        {canRevert && (
          <button
            type="button"
            onClick={handleRevert}
            title={t("messageList.turnRevert")}
            className="flex shrink-0 items-center gap-1 rounded-md border border-codezal px-2 py-0.5 text-sm text-codezal-dim transition-colors hover:border-codezal-strong hover:text-codezal-text"
          >
            <Undo2 className="h-3 w-3" /> {t("messageList.turnRevert")}
          </button>
        )}
        <button
          type="button"
          onClick={() => closeFile(uri)}
          title={t("common.close")}
          className="shrink-0 rounded p-1 text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-codezal-bg">
        {edits.files.length === 0 ? (
          <div className="p-6 text-md text-codezal-mute">{t("messageList.noChanges")}</div>
        ) : single &&
          canRevert &&
          messageId &&
          shown[0].file.lines.length > 0 &&
          !shown[0].file.path.includes(" → ") ? (
          <HunkReview messageId={messageId} path={shown[0].file.path} />
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
                {canRevert && !isRename && (
                  <div className="flex justify-end px-3 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleRevertFile(file.path)}
                      title={t("messageList.fileRevert")}
                      className="flex items-center gap-1 rounded text-sm text-codezal-mute transition-colors hover:text-codezal-text"
                    >
                      <Undo2 className="h-3 w-3" /> {t("messageList.fileRevert")}
                    </button>
                  </div>
                )}
                {file.lines.length === 0 && file.newContent != null ? (
                  <CodeView code={file.newContent} path={file.path} accent="add" />
                ) : (
                  <DiffView text={text} defaultOpen={single} />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function HunkReview({ messageId, path }: { messageId: string; path: string }) {
  const t = useT()
  const turnFileDiff = useSessionsStore((s) => s.turnFileDiff)
  const revertTurnHunk = useSessionsStore((s) => s.revertTurnHunk)
  const [lines, setLines] = useState<DiffLine[] | null | undefined>(undefined)
  const [reloadKey, setReloadKey] = useState(0)

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
      {hunks.map((h) => (
        <div key={h.index} className="border-b border-codezal">
          <div className="flex items-center justify-end px-3 py-1">
            <button
              type="button"
              onClick={() =>
                void revertTurnHunk(messageId, path, h.index).then((ok) => {
                  if (ok) setReloadKey((k) => k + 1)
                })
              }
              title={t("messageList.hunkRevert")}
              className="flex items-center gap-1 rounded text-sm text-codezal-mute transition-colors hover:text-codezal-text"
            >
              <Undo2 className="h-3 w-3" /> {t("messageList.hunkRevert")}
            </button>
          </div>
          <pre className="overflow-x-auto px-3 pb-2 font-mono text-sm leading-relaxed">
            {h.display.map((l, j) => (
              <div
                key={j}
                className={cn(
                  l.kind === "add" && "text-codezal-diff-add",
                  l.kind === "del" && "text-codezal-diff-del",
                  l.kind === "ctx" && "text-codezal-mute",
                )}
              >
                {(l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  )
}
