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
import "katex/dist/katex.min.css"
import "@/styles/highlight.css"
import { CodeBlock } from "./CodeBlock"
import { cn } from "@/lib/utils"

type Props = {
  content: string
  className?: string
  streaming?: boolean
}

const PROSE = cn(
  "prose prose-zinc dark:prose-invert max-w-none",
  "break-words",
  "text-md leading-[1.58] text-codezal-text",
  // Paragraf
  "prose-p:my-2 prose-p:text-md prose-p:text-codezal-text",
  "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-codezal-text",
  "prose-h1:text-2xl prose-h1:mt-5 prose-h1:mb-2.5",
  "prose-h2:text-xl prose-h2:mt-5 prose-h2:mb-2.5 prose-h2:pb-2 prose-h2:border-b prose-h2:border-codezal",
  "prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-1.5",
  "prose-h4:text-md prose-h4:mt-3 prose-h4:mb-1",
  // Vurgu
  "prose-strong:text-codezal-text prose-strong:font-semibold",
  "prose-em:text-codezal-text",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-md prose-li:text-codezal-text",
  "[&_li>p]:my-0",
  "marker:text-codezal-mute",
  // Linkler
  "prose-a:text-codezal-accent prose-a:no-underline hover:prose-a:underline",
  "prose-table:my-4 prose-table:text-base prose-table:w-full prose-table:border-separate prose-table:border-spacing-0 prose-table:overflow-hidden prose-table:rounded-xl prose-table:border prose-table:border-codezal",
  "prose-th:bg-codezal-panel-2 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-codezal-text prose-th:border-b prose-th:border-codezal",
  "prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-codezal/40 prose-td:align-top",
  "[&_tbody_tr:last-child_td]:border-b-0",
  "prose-code:before:hidden prose-code:after:hidden",
  "prose-code:rounded prose-code:bg-codezal-panel-2 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.92em] prose-code:font-normal prose-code:text-codezal-text",
  // <pre> CodeBlock'a delege — kendi stili var
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-3",
  // Blockquote
  "prose-blockquote:border-l-2 prose-blockquote:border-codezal-accent prose-blockquote:bg-codezal-panel-2/40 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:not-italic prose-blockquote:text-codezal-dim",
  "prose-hr:border-codezal prose-hr:my-3",
)

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
      return (
        <a
          {...rest}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            useSessionsStore.getState().openFile(uriToPath(href))
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
