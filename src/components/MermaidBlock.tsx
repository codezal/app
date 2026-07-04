import { useEffect, useRef, useState } from "react"
import { useT } from "@/lib/i18n/useT"

let mermaidCounter = 0

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false
  return document.documentElement.classList.contains("dark")
}

export function MermaidBlock({ code }: { code: string }) {
  const t = useT()
  const [result, setResult] = useState<{ svg: string | null; failed: boolean }>({
    svg: null,
    failed: false,
  })
  const idRef = useRef(`mermaid-${mermaidCounter++}`)
  const [trackedCode, setTrackedCode] = useState(code)
  if (trackedCode !== code) {
    setTrackedCode(code)
    setResult({ svg: null, failed: false })
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          theme: isDarkTheme() ? "dark" : "default",
          securityLevel: "strict",
        })
        const { svg: rendered } = await mermaid.render(idRef.current, code)
        if (alive) setResult({ svg: rendered, failed: false })
      } catch {
        if (alive) setResult({ svg: null, failed: true })
      }
    })()
    return () => {
      alive = false
    }
  }, [code])

  const { svg, failed } = result
  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border border-codezal bg-codezal-code p-3 font-mono text-sm text-codezal-text">
        {code}
      </pre>
    )
  }
  if (svg == null) {
    return (
      <div className="my-2 rounded-lg border border-codezal bg-codezal-code p-3 text-sm text-codezal-mute">
        {t("mermaid.rendering")}
      </div>
    )
  }
  return (
    <div
      className="my-2 flex justify-center overflow-x-auto rounded-lg border border-codezal bg-codezal-code p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
