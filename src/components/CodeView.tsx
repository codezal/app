// Code viewer for tool file output (read/write) — file-path header + a
// line-number gutter + highlight.js syntax colouring, matching the clean
// "code reading" style of Codex/Claude. Terminal/diff output keeps its own
// renderers; this is only for file content.
import { useMemo, useState } from "react"
import hljs from "highlight.js"
import { Check, Copy } from "@/lib/icons"
import "@/styles/highlight.css"
import { t as tStatic } from "@/lib/i18n"

// File extension → highlight.js language id. Unknown extensions fall back to
// auto-detection.
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  mdx: "markdown",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
}

function langFromPath(path?: string): string | undefined {
  if (!path) return undefined
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? EXT_LANG[ext] : undefined
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

type Props = {
  code: string
  path?: string
  meta?: string
  // Diff-stat counts shown in the header (a created file is +N -0).
  added?: number
  removed?: number
  // Colored left edge on the code body: "add" = green (created), "del" = red.
  accent?: "add" | "del"
  // Hard cap on rendered lines so a huge file doesn't blow up highlight/DOM.
  maxLines?: number
  startLine?: number
}

export function CodeView({ code, path, meta, added, removed, accent, maxLines = 400, startLine = 1 }: Props) {
  const [copied, setCopied] = useState(false)
  const lang = langFromPath(path)

  const { html, lineCount, hiddenLines } = useMemo(() => {
    const all = code.split("\n")
    const over = all.length - maxLines
    const shown = over > 0 ? all.slice(0, maxLines).join("\n") : code
    let value: string
    try {
      value =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(shown, { language: lang }).value
          : hljs.highlightAuto(shown).value
    } catch {
      value = escapeHtml(shown)
    }
    return {
      html: value,
      lineCount: over > 0 ? maxLines : all.length,
      hiddenLines: over > 0 ? over : 0,
    }
  }, [code, lang, maxLines])

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }

  return (
    <div className="group/code overflow-hidden rounded-xl border border-codezal-hair bg-codezal-code">
      {(path || meta || added != null || removed != null) && (
        <div className="flex items-center gap-2 border-b border-codezal-hair px-3 py-1.5 text-sm">
          {path && <span className="truncate font-mono text-codezal-text">{path}</span>}
          {added != null && (
            <span className="shrink-0 font-mono text-codezal-diff-add">+{added}</span>
          )}
          {removed != null && removed > 0 && (
            <span className="shrink-0 font-mono text-codezal-diff-del">-{removed}</span>
          )}
          {meta && <span className="shrink-0 text-codezal-mute">· {meta}</span>}
          <button
            type="button"
            onClick={onCopy}
            title={tStatic("messageList.copyBlockTitle")}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-sm text-codezal-mute opacity-0 transition hover:text-codezal-text group-hover/code:opacity-100 focus-visible:opacity-100"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" /> {tStatic("messageList.copiedLabel")}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> {tStatic("messageList.copyLabel")}
              </>
            )}
          </button>
        </div>
      )}
      {/* Single scroll container for BOTH axes — never a scrollbar inside a
          scrollbar. (overflow-y-auto here + overflow-x-auto on the pre would
          make CSS promote the pre's overflow-y to auto too → a 2nd vertical
          bar.) Capped height; scroll past it. */}
      <div
        className="flex max-h-[420px] overflow-auto"
        style={
          accent
            ? { borderLeft: `3px solid hsl(var(--codezal-diff-${accent}))` }
            : undefined
        }
      >
        <div
          aria-hidden
          className="shrink-0 select-none py-3 pl-3 pr-3 text-right font-mono text-sm leading-[1.65] text-codezal-mute/60"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{startLine + i}</div>
          ))}
        </div>
        <pre className="flex-1 py-3 pr-4 font-mono text-sm leading-[1.65] text-codezal-text">
          <code
            className="hljs !bg-transparent !p-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
      {hiddenLines > 0 && (
        <div className="border-t border-codezal-hair px-3 py-1.5 text-sm text-codezal-mute">
          {tStatic("messageList.moreLines", { count: hiddenLines })}
        </div>
      )}
    </div>
  )
}
