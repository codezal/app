// React Markdown + GFM + Math + highlight.js kod boyama.
// Mesaj gövdesi tek render noktası.
import { Component, memo, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import "katex/dist/katex.min.css"
// Highlight teması: light tema için `github`, dark için `github-dark`.
// `Markdown` kendi CSS dosyası ile her iki paleti class-scope (html.dark) ile yükler.
import "@/styles/highlight.css"
import { CodeBlock } from "./CodeBlock"
import { cn } from "@/lib/utils"

type Props = {
  content: string
  className?: string
}

// React.memo — içerik aynıysa pahalı remark/rehype parse'ı tekrarlanmasın.
// Stream sırasında binlerce kez bubble re-render olur; yalnız son mesajın
// içeriği değişir, diğerleri aynı kalır.
export const Markdown = memo(MarkdownImpl)

function MarkdownImpl({ content, className }: Props) {
  return (
    <MarkdownBoundary fallback={content}>
      <div
        className={cn(
          // Temel akış: 14px / 1.65, tek kolon
          "prose prose-zinc dark:prose-invert max-w-none",
          "text-[14px] leading-[1.65] text-codezal-text",
          // Paragraf
          "prose-p:my-2.5 prose-p:text-codezal-text",
          // Başlıklar — net hiyerarşi
          "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-codezal-text",
          "prose-h1:text-[20px] prose-h1:mt-6 prose-h1:mb-3",
          "prose-h2:text-[17px] prose-h2:mt-6 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b prose-h2:border-codezal",
          "prose-h3:text-[15px] prose-h3:mt-5 prose-h3:mb-2",
          "prose-h4:text-[14px] prose-h4:mt-4 prose-h4:mb-1.5",
          // Vurgu
          "prose-strong:text-codezal-text prose-strong:font-semibold",
          "prose-em:text-codezal-text",
          // Listeler
          "prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-1 prose-li:text-codezal-text",
          "marker:text-codezal-mute",
          // Linkler
          "prose-a:text-codezal-accent prose-a:no-underline hover:prose-a:underline",
          // Tablolar — okunabilir kenar + zebra benzeri tek başlık
          "prose-table:my-4 prose-table:text-[13px] prose-table:w-full",
          "prose-th:bg-codezal-panel-2 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-codezal-text prose-th:border-b prose-th:border-codezal-strong",
          "prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-codezal prose-td:align-top",
          // Inline code — chip görünümü (block ile karışmasın)
          "prose-code:before:hidden prose-code:after:hidden",
          "prose-code:rounded prose-code:bg-codezal-code-chip prose-code:px-1.5 prose-code:py-[1px] prose-code:text-[12.5px] prose-code:font-medium prose-code:text-codezal-text",
          // <pre> CodeBlock'a delege — kendi stili var
          "prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-3",
          // Blockquote
          "prose-blockquote:border-l-2 prose-blockquote:border-codezal-accent prose-blockquote:bg-codezal-panel-2/40 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:not-italic prose-blockquote:text-codezal-dim",
          // Yatay çizgi
          "prose-hr:border-codezal prose-hr:my-5",
          className,
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
          rehypePlugins={[
            rehypeKatex,
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
          ]}
          components={{
            // highlight.js çıktısı <pre><code class="hljs language-x"> verir;
            // CodeBlock copy button + dil etiketi sarmalar.
            pre: ({ children, ...props }) => (
              <CodeBlock {...(props as object)}>{children}</CodeBlock>
            ),
            a: ({ href, children, ...rest }) => (
              <a
                {...rest}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownBoundary>
  )
}

// Markdown render crash olursa düz metin göster, app çökmesin.
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
  }
  render() {
    if (this.state.error) {
      return (
        <pre className="whitespace-pre-wrap text-[13px] text-codezal-text">
          {this.props.fallback}
        </pre>
      )
    }
    return this.props.children
  }
}
