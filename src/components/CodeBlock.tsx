// Shiki ile boyanmış kod blokları için sarmalayıcı.
// Üst köşede dil etiketi + kopyala butonu.
import { useState, type ReactNode } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  children?: ReactNode
  className?: string
}

// Shiki çıktısından dili çıkar. Tipik şekil:
// <pre><code class="language-ts">...</code></pre>
function extractLanguage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null
  const el = node as { props?: { className?: unknown } }
  const cls = el.props?.className
  if (typeof cls === "string") {
    const m = cls.match(/language-([a-z0-9+#-]+)/i)
    if (m) return m[1]
  }
  return null
}

function extractTextContent(node: unknown): string {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map(extractTextContent).join("")
  if (node && typeof node === "object") {
    const el = node as { props?: { children?: unknown } }
    return extractTextContent(el.props?.children)
  }
  return ""
}

export function CodeBlock({ children, className }: Props) {
  const [copied, setCopied] = useState(false)
  const lang = extractLanguage(children)
  const text = extractTextContent(children)

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // sessiz geç
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-codezal-strong bg-codezal-code">
      <div className="flex items-center justify-between border-b border-codezal bg-codezal-panel-2/70 px-4 py-2 text-[11px] text-codezal-mute">
        <span className="font-mono uppercase tracking-[0.08em]">{lang ?? "text"}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-codezal-dim opacity-0 transition hover:bg-codezal-chip hover:text-codezal-text group-hover:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> kopyalandı
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> kopyala
            </>
          )}
        </button>
      </div>
      <pre
        className={cn(
          // prose-pre:p-0 nedeniyle padding ezilmesin — important.
          "!m-0 overflow-x-auto !bg-codezal-code !px-4 !py-3.5 font-mono text-[12.5px] leading-[1.65] text-codezal-text",
          "[&>code.hljs]:!bg-transparent [&>code.hljs]:!p-0 [&>code]:!bg-transparent [&>code]:!p-0",
          className,
        )}
      >
        {children}
      </pre>
    </div>
  )
}
