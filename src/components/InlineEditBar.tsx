import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Loader2, Sparkles, XCircle } from "@/lib/icons"
import { useT } from "@/lib/i18n/useT"
import { useSettingsStore } from "@/store/settings"
import { generateInlineEdit } from "@/lib/inline-edit"
import { lineDiff } from "@/lib/diff"
import type { ProviderId } from "@/lib/providers"
import type { InlineSelection } from "@/components/CodeEditor"
import { cn } from "@/lib/utils"

type Props = {
  selection: InlineSelection
  rect: { top: number; bottom: number; left: number } | null
  language: string
  providerId: ProviderId
  modelId: string
  onAccept: (newText: string) => void
  onClose: () => void
}

const WIDTH = 440

type Phase = "input" | "generating" | "preview" | "error"

export function InlineEditBar({
  selection,
  rect,
  language,
  providerId,
  modelId,
  onAccept,
  onClose,
}: Props) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>("input")
  const [instruction, setInstruction] = useState("")
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase === "input" || phase === "preview") inputRef.current?.focus()
  }, [phase])

  // de iptal eder (unmount).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        abortRef.current?.abort()
        onClose()
      }
    }
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        abortRef.current?.abort()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown, true)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onDown, true)
      abortRef.current?.abort()
    }
  }, [onClose])

  async function run() {
    const trimmed = instruction.trim()
    if (!trimmed) return
    setPhase("generating")
    setResult("")
    setError("")
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const out = await generateInlineEdit({
        providerId,
        modelId,
        settings: useSettingsStore.getState().settings,
        language,
        prefix: selection.prefix,
        selection: selection.text,
        suffix: selection.suffix,
        instruction: trimmed,
        signal: ac.signal,
        onDelta: setResult,
      })
      if (ac.signal.aborted) return
      setResult(out)
      setPhase("preview")
    } catch (e) {
      if (ac.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setPhase("error")
    }
  }

  const diff = useMemo(
    () => (phase === "preview" ? lineDiff(selection.text, result) : []),
    [phase, selection.text, result],
  )

  const style: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: Math.min(rect.bottom + 6, window.innerHeight - 240),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)),
        width: WIDTH,
      }
    : { position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", width: WIDTH }

  return (
    <div
      ref={barRef}
      style={style}
      className="z-50 overflow-hidden cz-menu"
    >
      <div className="flex items-center gap-2 border-b border-codezal px-2.5 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-codezal-accent" />
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              if (phase === "preview") onAccept(result)
              else if (phase !== "generating") void run()
            }
          }}
          placeholder={t("inlineEdit.placeholder")}
          readOnly={phase === "generating"}
          spellCheck={false}
          className={cn(
            "flex-1 bg-transparent text-sm text-codezal-text placeholder:text-codezal-mute outline-none",
            phase === "generating" && "opacity-60",
          )}
        />
        {phase === "generating" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-codezal-mute" />}
        <span className="shrink-0 text-sm text-codezal-mute">esc</span>
      </div>

      {phase === "generating" && (
        <pre className="max-h-40 overflow-auto px-3 py-2 font-mono text-sm leading-relaxed text-codezal-mute whitespace-pre-wrap">
          {result || t("inlineEdit.generating")}
        </pre>
      )}

      {phase === "preview" && (
        <>
          <div className="max-h-56 overflow-auto font-mono text-sm leading-relaxed">
            {diff.map((ln, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap px-3",
                  ln.kind === "add" && "bg-green-500/10 text-green-300",
                  ln.kind === "del" && "bg-red-500/10 text-red-300",
                  ln.kind === "ctx" && "text-codezal-mute",
                )}
              >
                {ln.kind === "add" ? "+" : ln.kind === "del" ? "-" : " "}
                {ln.text}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-codezal px-2.5 py-1.5">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              <XCircle className="h-3.5 w-3.5" /> {t("inlineEdit.reject")}
            </button>
            <button
              type="button"
              onClick={() => onAccept(result)}
              className="flex items-center gap-1 rounded bg-codezal-accent px-2 py-1 text-sm text-white"
            >
              <Check className="h-3.5 w-3.5" /> {t("inlineEdit.accept")}
            </button>
          </div>
        </>
      )}

      {/* Hata */}
      {phase === "error" && (
        <div className="px-3 py-2 text-sm text-red-400">
          {t("inlineEdit.failed")}: {error}
        </div>
      )}
    </div>
  )
}
