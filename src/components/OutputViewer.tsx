// URI'lerini bununla render eder (diff URI'leri DiffViewer, normal yollar FileViewer).
import { useState } from "react"
import { Check, Copy } from "@/lib/icons"
import { getOutputContent, parseOutputUri } from "@/lib/output-doc"
import { useT } from "@/lib/i18n/useT"

export function OutputViewer({ uri }: { uri: string }) {
  const t = useT()
  const parsed = parseOutputUri(uri)
  const content = parsed ? getOutputContent(parsed.id) : undefined
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-codezal-bg">
      <div className="flex items-center gap-2 border-b border-codezal-hair px-3 py-1.5">
        <span className="truncate text-sm text-codezal-dim">{parsed?.title ?? t("outputViewer.title")}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void onCopy()}
          disabled={!content}
          className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      {content === undefined ? (
        <div className="px-3 py-3 text-sm text-codezal-mute">{t("outputViewer.gone")}</div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-sm leading-relaxed text-codezal-text">
          {content}
        </pre>
      )}
    </div>
  )
}
