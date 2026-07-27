// React Markdown + GFM + Math + highlight.js kod boyama.
//
import { Component, memo, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import remend from "remend"
import { captureError } from "@/lib/report"
import { useSessionsStore } from "@/store/sessions"
import { uriToPath } from "@/lib/uri"
import { isBinaryPath, openWithDefault } from "@/lib/open"
import "katex/dist/katex.min.css"
import "@/styles/highlight.css"
import { CodeBlock } from "./CodeBlock"
import { cn } from "@/lib/utils"
import { PROSE } from "./markdown-prose"

type Props = {
  content: string
  className?: string
  streaming?: boolean
}

const REMARK_RICH = [remarkGfm, remarkBreaks, remarkMath]
// detect:false — only highlight fenced blocks with an explicit language. Auto-detect
// (highlightAuto) mislabels plain command/git output as scss/less ("feat(x):", "+/-",
// "→" score like CSS/LESS tokens), showing a bogus language label + wrong colors.
// Unlabeled blocks now render as plain "text"; ```ts / ```bash still highlight.
const REHYPE_RICH = [rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]
const REMARK_LITE = [remarkGfm, remarkBreaks]
const REHYPE_LITE: [] = []

const MD_COMPONENTS: Components = {
  pre: ({ children, ...props }) => <CodeBlock {...(props as object)}>{children}</CodeBlock>,
  a: ({ href, children, ...rest }) => {
    if (href && href.startsWith("file:")) {
      const path = uriToPath(href)
      // Binaries / previews the editor can't open go to the OS instead; if the
      // opener fails (e.g. not in a Tauri webview) fall back to the editor.
      const openInOs = isBinaryPath(path)
      return (
        <a
          {...rest}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (openInOs) {
              void openWithDefault(path).catch(() => useSessionsStore.getState().openFile(path))
            } else {
              useSessionsStore.getState().openFile(path)
            }
          }}
          className="cursor-pointer text-primary underline-offset-2 hover:underline"
        >
          {children}
        </a>
      )
    }
    return (
      <a
        {...rest}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline-offset-2 hover:underline"
      >
        {children}
      </a>
    )
  },
}

type SeverityTone = "critical" | "high" | "medium" | "low"

const SEVERITY_STYLES: Record<SeverityTone, string> = {
  critical: "border-destructive/40 bg-destructive/10 [&_strong:first-child]:text-destructive",
  high: "border-amber-500/40 bg-amber-500/10 [&_strong:first-child]:text-amber-500",
  medium: "border-codezal-accent/40 bg-codezal-accent/10 [&_strong:first-child]:text-codezal-accent",
  low: "border-codezal-strong bg-[hsl(var(--codezal-panel-2)_/_0.45)] [&_strong:first-child]:text-codezal-dim",
}

function severityTone(text: string): SeverityTone | null {
  const label = /^\*\*\s*([^:*]+)\s*:\s*\*\*/.exec(text.trim())?.[1]?.toLocaleLowerCase()
  if (!label) return null
  if (label === "critical" || label === "kritik") return "critical"
  if (label === "high" || label === "yüksek") return "high"
  if (label === "medium" || label === "orta") return "medium"
  if (label === "low" || label === "düşük") return "low"
  return null
}

const Block = memo(function Block({
  text,
  rich,
  severity,
}: {
  text: string
  rich: boolean
  severity: SeverityTone | null
}) {
  return (
    <div
      className={cn(
        severity &&
          "my-2 rounded-lg border px-3 py-0.5 [&>p]:my-1.5",
        severity && SEVERITY_STYLES[severity],
      )}
    >
      <ReactMarkdown
        remarkPlugins={rich ? REMARK_RICH : REMARK_LITE}
        rehypePlugins={(rich ? REHYPE_RICH : REHYPE_LITE) as ComponentPropsWithoutRef<typeof ReactMarkdown>["rehypePlugins"]}
        components={MD_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function splitBlocks(src: string): string[] {
  const lines = src.split("\n")
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  let fenceChar = ""
  for (const line of lines) {
    const m = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (m && m[1]) {
      const ch = m[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = ch
      } else if (ch === fenceChar) {
        inFence = false
        fenceChar = ""
      }
    }
    if (
      !inFence &&
      /^\*\*\s*(?:critical|high|medium|low|kritik|yüksek|orta|düşük)\s*:\s*\*\*/i.test(
        line.trim(),
      )
    ) {
      if (cur.length > 0) blocks.push(cur.join("\n"))
      cur = [line]
      continue
    }
    if (!inFence && line.trim() === "") {
      if (cur.length > 0) {
        blocks.push(cur.join("\n"))
        cur = []
      }
    } else {
      cur.push(line)
    }
  }
  if (cur.length > 0) blocks.push(cur.join("\n"))
  return blocks
}

function healSafe(raw: string): string {
  try {
    return remend(raw, { linkMode: "text-only" })
  } catch {
    return raw
  }
}

export const Markdown = memo(MarkdownImpl)

function MarkdownImpl({ content, className, streaming }: Props) {
  const blocks = useMemo(() => splitBlocks(content), [content])
  return (
    <MarkdownBoundary fallback={content}>
      <div className={cn(PROSE, className)}>
        {blocks.map((raw, i) => {
          const live = !!streaming && i === blocks.length - 1
          return (
            <Block
              key={`b${i}`}
              text={live ? healSafe(raw) : raw}
              rich={!live}
              severity={severityTone(raw)}
            />
          )
        })}
      </div>
    </MarkdownBoundary>
  )
}

class MarkdownBoundary extends Component<
  { children: ReactNode; fallback: string },
  { error: boolean }
> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch(err: unknown) {
    console.error("Markdown render error:", err)
    void captureError(err, "markdown-render")
  }
  render() {
    if (this.state.error) {
      return (
        <pre className="whitespace-pre-wrap text-base text-codezal-text">
          {this.props.fallback}
        </pre>
      )
    }
    return this.props.children
  }
}
