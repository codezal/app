// Paylaşılan markdown "prose" sınıf seti — hem sohbet render'ı (Markdown.tsx)
// hem WYSIWYG editörü (MarkdownWysiwyg) aynı tipografiyi kullansın diye
// ayrı dosyada tutulur (react-refresh tek-component-export kuralı).
import { cn } from "@/lib/utils"

export const PROSE = cn(
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
  // <pre> — Markdown.tsx CodeBlock'a deleg eder; WYSIWYG kendi css'inde boyar
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-3",
  // Blockquote
  "prose-blockquote:border-l-2 prose-blockquote:border-codezal-accent prose-blockquote:bg-codezal-panel-2/40 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:not-italic prose-blockquote:text-codezal-dim",
  "prose-hr:border-codezal prose-hr:my-3",
)
