// Dosya görüntüleyici — read-only, syntax highlight (markdown code fence ile rehype-highlight)
import { useEffect, useState } from "react"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { Markdown } from "./Markdown"

type Props = {
  path: string
}

export function FileViewer({ path }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setContent(null)
    setError(null)
    readTextFile(path)
      .then((t) => {
        if (!alive) return
        if (t.length > 500_000) {
          setContent(t.slice(0, 500_000))
          setError(`Dosya büyük — ilk 500K char gösteriliyor (toplam ${t.length})`)
        } else {
          setContent(t)
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [path])

  const lang = extLang(path)
  const isMarkdown = lang === "markdown"
  // Markdown dosyaları doğrudan render — fence içine sokarsak içerideki ``` blokları dış
  // fence'i kapatır ve sayfa bozulur. Diğer diller için içeriğin maksimum backtick
  // dizisini ölç ve dış fence'i bir fazla yap (kod içindeki ```'ları kaçırmak için).
  const md =
    content === null
      ? ""
      : isMarkdown
      ? content
      : wrapInFence(content, lang)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full px-8 pt-5">
        <div className="flex items-center gap-2 border-b border-codezal pb-3 text-[12px] text-codezal-mute">
          <span className="truncate text-codezal-text">{path}</span>
          {content && <span className="ml-auto">{content.length} char</span>}
        </div>
        <div className="py-5">
          {error && (
            <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
          {content === null && !error ? (
            <div className="text-[12px] text-codezal-mute">Yükleniyor…</div>
          ) : (
            <Markdown content={md} className="text-[12.5px] leading-[1.55]" />
          )}
        </div>
      </div>
    </div>
  )
}

// İçerikteki en uzun ``` dizisinden 1 fazla backtick ile sar — collision yok.
function wrapInFence(content: string, lang: string): string {
  let maxRun = 2 // en az 3 backtick
  const re = /`+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m[0].length > maxRun) maxRun = m[0].length
  }
  const fence = "`".repeat(maxRun + 1)
  return fence + lang + "\n" + content + "\n" + fence
}

// Uzantı → highlight.js dil etiketi
function extLang(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!m) return ""
  const ext = m[1]
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    rs: "rust",
    go: "go",
    py: "python",
    rb: "ruby",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    php: "php",
    xml: "xml",
    env: "ini",
    dockerfile: "dockerfile",
    prisma: "prisma",
  }
  return map[ext] ?? ""
}
