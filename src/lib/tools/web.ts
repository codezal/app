// Web tool'ları — webfetch ve websearch.
// webfetch: bash + curl ile sayfa indir, HTML'i sadeleştirilmiş metne çevir.
// websearch: opsiyonel Tavily veya Brave Search API ile arama yap (settings'te key gerekir).
import { Command } from "@tauri-apps/plugin-shell"
import type { WebSearchConfig } from "@/store/types"

// CORS sorunlarını aşmak için browser fetch yerine curl kullan.
// Tauri shell zaten bash -lc izinli; curl native binary olarak çağrılır.
async function curlGet(
  url: string,
  opts: { headers?: Record<string, string>; maxBytes?: number; timeoutSec?: number } = {},
): Promise<{ status: number; body: string }> {
  const headers = opts.headers ?? {
    "User-Agent": "Mozilla/5.0 (Codezal)",
    Accept: "text/html,application/xhtml+xml,*/*",
  }
  const maxBytes = opts.maxBytes ?? 5_000_000
  const timeout = opts.timeoutSec ?? 30

  const headerArgs = Object.entries(headers)
    .map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`)
    .join(" ")

  // -sSL: sessiz + hata kodları + redirect izle
  // -w "\n__STATUS__%{http_code}": son satırda HTTP kodu
  // --max-time + --max-filesize güvenlik sınırı
  const cmd = `curl -sSL --max-time ${timeout} --max-filesize ${maxBytes} ${headerArgs} -w "\\n__STATUS__%{http_code}" ${shellQuote(url)}`

  const result = await Command.create("bash", ["-lc", cmd]).execute()
  if (result.code !== 0) {
    throw new Error(`curl hatası (exit ${result.code}): ${result.stderr.trim() || "bilinmiyor"}`)
  }
  const out = result.stdout
  const m = out.match(/\n__STATUS__(\d+)\s*$/)
  const status = m ? parseInt(m[1], 10) : 0
  const body = m ? out.slice(0, out.length - m[0].length) : out
  return { status, body }
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// HTML → sadeleştirilmiş metin. script/style/nav/footer çıkar, h1-h6/p/a/li işle.
// DOMParser kullan (Tauri webview Chromium tabanlı).
export function htmlToText(html: string, baseUrl?: string): string {
  if (!html.trim()) return ""
  // Eğer HTML değilse (text/plain, json), olduğu gibi dön
  if (!/<html|<body|<!doctype/i.test(html.slice(0, 2000))) {
    return html.slice(0, 100_000)
  }
  const doc = new DOMParser().parseFromString(html, "text/html")

  // Gürültüyü sil
  doc.querySelectorAll("script, style, noscript, iframe, svg, nav, header, footer, aside, form")
    .forEach((el) => el.remove())

  // Başlık (sayfanın <title>)
  const title = doc.querySelector("title")?.textContent?.trim() ?? ""

  // Ana içeriği bul — article > main > body sırasıyla
  const root: Element =
    doc.querySelector("article") ??
    doc.querySelector("main") ??
    doc.body ??
    doc.documentElement

  const out: string[] = []
  if (title) out.push(`# ${title}`, "")

  walkNode(root, out, baseUrl)

  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return text
}

// DOM'u dolaş, markdown benzeri çıktı üret.
function walkNode(node: Node, out: string[], baseUrl?: string): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent?.replace(/\s+/g, " ").trim()
    if (t) out.push(t)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  const tag = el.tagName.toLowerCase()

  if (/^h[1-6]$/.test(tag)) {
    const lvl = parseInt(tag.slice(1), 10)
    const text = (el.textContent ?? "").trim()
    if (text) out.push("", "#".repeat(lvl) + " " + text, "")
    return
  }
  if (tag === "p") {
    const text = collectInline(el, baseUrl)
    if (text) out.push("", text, "")
    return
  }
  if (tag === "li") {
    const text = collectInline(el, baseUrl)
    if (text) out.push("- " + text)
    return
  }
  if (tag === "pre" || tag === "code") {
    const code = el.textContent ?? ""
    if (code.trim()) {
      if (tag === "pre") out.push("", "```", code.trimEnd(), "```", "")
      else out.push("`" + code + "`")
    }
    return
  }
  if (tag === "br") {
    out.push("")
    return
  }
  if (tag === "a") {
    const text = (el.textContent ?? "").trim()
    const href = (el as HTMLAnchorElement).getAttribute("href")
    if (text && href) {
      out.push(`[${text}](${resolveUrl(href, baseUrl)})`)
    } else if (text) {
      out.push(text)
    }
    return
  }
  // Diğer container — alt düğümleri yürü
  for (const child of Array.from(el.childNodes)) walkNode(child, out, baseUrl)
}

function collectInline(el: Element, baseUrl?: string): string {
  const buf: string[] = []
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      buf.push((c.textContent ?? "").replace(/\s+/g, " "))
    } else if (c.nodeType === Node.ELEMENT_NODE) {
      const child = c as Element
      const tag = child.tagName.toLowerCase()
      if (tag === "a") {
        const t = (child.textContent ?? "").trim()
        const href = (child as HTMLAnchorElement).getAttribute("href")
        buf.push(t && href ? `[${t}](${resolveUrl(href, baseUrl)})` : t)
      } else if (tag === "code") {
        buf.push("`" + (child.textContent ?? "") + "`")
      } else if (tag === "strong" || tag === "b") {
        buf.push("**" + (child.textContent ?? "") + "**")
      } else if (tag === "em" || tag === "i") {
        buf.push("_" + (child.textContent ?? "") + "_")
      } else {
        buf.push(child.textContent ?? "")
      }
    }
  }
  return buf.join("").replace(/\s+/g, " ").trim()
}

function resolveUrl(href: string, base?: string): string {
  if (!base) return href
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

// webfetch: URL'i indir + metne çevir + sınırla.
export async function webfetch(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Geçersiz URL — http:// veya https:// ile başlamalı")
  }
  const { status, body } = await curlGet(url)
  if (status >= 400) {
    return `HTTP ${status} — ${url}\n\n${body.slice(0, 2000)}`
  }
  const text = htmlToText(body, url)
  // Output sınırı
  if (text.length > 50_000) {
    return text.slice(0, 50_000) + `\n\n... (kesildi, toplam ${text.length} char)`
  }
  return text || "(boş içerik)"
}

// websearch: Tavily veya Brave API kullan.
// Settings'te webSearch konfigi gerekir; yoksa kullanıcıya yönlendir.
export async function websearch(
  query: string,
  config: WebSearchConfig | undefined,
  maxResults = 5,
): Promise<string> {
  if (!config?.apiKey) {
    throw new Error(
      "Web arama yapılandırılmamış. Ayarlar > Web Arama'dan Tavily veya Brave API anahtarı ekle.",
    )
  }
  if (config.provider === "tavily") {
    return await tavilySearch(query, config.apiKey, maxResults)
  }
  return await braveSearch(query, config.apiKey, maxResults)
}

async function tavilySearch(query: string, apiKey: string, maxResults: number): Promise<string> {
  const payload = JSON.stringify({
    query,
    max_results: maxResults,
    search_depth: "basic",
    include_answer: true,
  })
  // Tavily CORS allow eder ama tutarlılık için curl üzerinden gidiyoruz.
  const cmd = `curl -sSL --max-time 30 -X POST https://api.tavily.com/search \
    -H ${shellQuote(`Authorization: Bearer ${apiKey}`)} \
    -H 'Content-Type: application/json' \
    -d ${shellQuote(payload)}`
  const result = await Command.create("bash", ["-lc", cmd]).execute()
  if (result.code !== 0) {
    throw new Error(`Tavily hatası: ${result.stderr.trim()}`)
  }
  const data = JSON.parse(result.stdout) as {
    answer?: string
    results?: Array<{ title: string; url: string; content: string; score: number }>
    error?: string
  }
  if (data.error) throw new Error(`Tavily: ${data.error}`)
  const out: string[] = []
  if (data.answer) out.push(`**Özet:** ${data.answer}`, "")
  ;(data.results ?? []).forEach((r, i) => {
    out.push(`${i + 1}. **${r.title}** — ${r.url}`)
    if (r.content) out.push(`   ${r.content.slice(0, 400)}`)
    out.push("")
  })
  return out.join("\n").trim() || "(sonuç yok)"
}

async function braveSearch(query: string, apiKey: string, maxResults: number): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`
  const cmd = `curl -sSL --max-time 30 ${shellQuote(url)} -H ${shellQuote(`X-Subscription-Token: ${apiKey}`)} -H 'Accept: application/json'`
  const result = await Command.create("bash", ["-lc", cmd]).execute()
  if (result.code !== 0) {
    throw new Error(`Brave hatası: ${result.stderr.trim()}`)
  }
  const data = JSON.parse(result.stdout) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> }
    error?: { code: number; message: string }
  }
  if (data.error) throw new Error(`Brave: ${data.error.message}`)
  const results = data.web?.results ?? []
  const out = results.map(
    (r, i) =>
      `${i + 1}. **${r.title}** — ${r.url}\n   ${(r.description ?? "").slice(0, 400)}`,
  )
  return out.join("\n\n") || "(sonuç yok)"
}
