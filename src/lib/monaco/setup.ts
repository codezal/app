import * as monaco from "monaco-editor"
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
import { loader } from "@monaco-editor/react"
import { registerNextEditProvider } from "@/lib/next-edit"

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new JsonWorker()
      case "css":
      case "scss":
      case "less":
        return new CssWorker()
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker()
      case "typescript":
      case "javascript":
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}

loader.config({ monaco })

registerNextEditProvider()

// monaco 0.55: languages.typescript namespace tipte { deprecated: true } stub'a indirildi;
type TsLangDefaults = {
  setDiagnosticsOptions(opts: {
    noSemanticValidation?: boolean
    noSyntaxValidation?: boolean
    noSuggestionDiagnostics?: boolean
  }): void
}
const tsLang = monaco.languages.typescript as unknown as {
  typescriptDefaults: TsLangDefaults
  javascriptDefaults: TsLangDefaults
}
tsLang.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
})
tsLang.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
})

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  php: "php",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  rb: "ruby",
  toml: "ini",
  ini: "ini",
  env: "ini",
  swift: "swift",
  dockerfile: "dockerfile",
  vue: "html",
  svelte: "html",
  graphql: "graphql",
  gql: "graphql",
}

export function monacoLanguageFor(path: string): string {
  const base = path.toLowerCase().split(/[\\/]/).pop() ?? ""
  if (base === "dockerfile") return "dockerfile"
  const m = base.match(/\.([a-z0-9]+)$/)
  if (!m) return "plaintext"
  return EXT_TO_LANG[m[1]] ?? "plaintext"
}

// --- Tema ---

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function readCssHsl(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!v) return fallback
  const m = v.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/)
  if (!m) return fallback
  return hslToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark")
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")
  return `${hex}${a}`
}

function defineCodezalTheme() {
  const dark = isDarkMode()

  const bg = readCssHsl("--codezal-bg", dark ? "#0f0f12" : "#f6f5ef")
  const panel = readCssHsl("--codezal-panel-2", dark ? "#1b1b1f" : "#eeead8")
  const text = readCssHsl("--codezal-text", dark ? "#f0f0f0" : "#181410")
  const mute = readCssHsl("--codezal-text-mute", dark ? "#8a8a8a" : "#615a51")
  const border = readCssHsl("--codezal-border", dark ? "#2a2a2a" : "#dcd3c4")
  const accent = readCssHsl("--codezal-accent", "#616161")

  const comment = dark ? "#808080" : "#7e7166"
  const keyword = dark ? "#ff7b72" : "#d73a49"
  const typeColor = dark ? "#d2a8ff" : "#6f42c1"
  const stringColor = dark ? "#a5d6ff" : "#032f62"
  const numberColor = dark ? "#79c0ff" : "#005cc5"
  const regexpColor = dark ? "#ffa198" : "#b31d28"

  // Monaco rules: hex foreground "#" SUZ verilir.
  const noHash = (c: string) => c.replace(/^#/, "")

  monaco.editor.defineTheme("codezal", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: noHash(comment), fontStyle: "italic" },
      { token: "keyword", foreground: noHash(keyword) },
      { token: "keyword.flow", foreground: noHash(keyword) },
      { token: "operator", foreground: noHash(keyword) },
      { token: "type", foreground: noHash(typeColor) },
      { token: "type.identifier", foreground: noHash(typeColor) },
      { token: "identifier.function", foreground: noHash(typeColor) },
      { token: "string", foreground: noHash(stringColor) },
      { token: "string.escape", foreground: noHash(regexpColor) },
      { token: "string.quote", foreground: noHash(stringColor) },
      { token: "number", foreground: noHash(numberColor) },
      { token: "number.hex", foreground: noHash(numberColor) },
      { token: "regexp", foreground: noHash(regexpColor) },
      { token: "tag", foreground: noHash(numberColor) },
      { token: "tag.id", foreground: noHash(numberColor) },
      { token: "attribute.name", foreground: noHash(numberColor) },
      { token: "attribute.value", foreground: noHash(stringColor) },
      { token: "metatag", foreground: noHash(typeColor) },
      { token: "constant", foreground: noHash(numberColor) },
      { token: "variable", foreground: noHash(text) },
      { token: "variable.parameter", foreground: noHash(text) },
      { token: "delimiter", foreground: noHash(text) },
      { token: "delimiter.bracket", foreground: noHash(mute) },
      { token: "predefined", foreground: noHash(typeColor) },
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": text,
      "editorCursor.foreground": text,
      "editorLineNumber.foreground": withAlpha(mute, 0.6),
      "editorLineNumber.activeForeground": text,
      "editor.lineHighlightBackground": withAlpha(panel, 0.4),
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": withAlpha(accent, 0.3),
      "editor.inactiveSelectionBackground": withAlpha(accent, 0.18),
      "editor.selectionHighlightBackground": withAlpha(accent, 0.15),
      "editor.wordHighlightBackground": withAlpha(accent, 0.18),
      "editor.wordHighlightStrongBackground": withAlpha(accent, 0.25),
      "editor.findMatchBackground": withAlpha(accent, 0.6),
      "editor.findMatchHighlightBackground": withAlpha(accent, 0.28),
      "editor.findRangeHighlightBackground": withAlpha(accent, 0.15),
      "editorIndentGuide.background1": withAlpha(border, 0.25),
      "editorIndentGuide.activeBackground1": withAlpha(border, 0.5),
      "editorWhitespace.foreground": withAlpha(border, 0.3),
      "editorGutter.background": bg,
      "editorBracketMatch.background": withAlpha(accent, 0.2),
      "editorBracketMatch.border": withAlpha(accent, 0.5),
      "editorWidget.background": panel,
      "editorWidget.foreground": text,
      "editorWidget.border": withAlpha(border, 0.6),
      "editorSuggestWidget.background": panel,
      "editorSuggestWidget.border": withAlpha(border, 0.6),
      "editorSuggestWidget.foreground": text,
      "editorSuggestWidget.selectedBackground": withAlpha(accent, 0.3),
      "editorSuggestWidget.highlightForeground": typeColor,
      "editorHoverWidget.background": panel,
      "editorHoverWidget.border": withAlpha(border, 0.6),
      "editorHoverWidget.foreground": text,
      "editorError.foreground": "#f85149",
      "editorWarning.foreground": "#d29922",
      "editorInfo.foreground": numberColor,
      "scrollbarSlider.background": withAlpha(mute, 0.3),
      "scrollbarSlider.hoverBackground": withAlpha(mute, 0.5),
      "scrollbarSlider.activeBackground": withAlpha(mute, 0.7),
      "minimap.background": bg,
      "input.background": panel,
      "input.foreground": text,
      "input.border": withAlpha(border, 0.5),
      "focusBorder": withAlpha(accent, 0.6),
    },
  })
}

export function applyCurrentTheme() {
  defineCodezalTheme()
  monaco.editor.setTheme("codezal")
}

let themeObs: MutationObserver | null = null
export function watchThemeChanges() {
  if (themeObs) return
  themeObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes" && m.attributeName === "class") {
        applyCurrentTheme()
        break
      }
    }
  })
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
}

let prewarmed = false
export function prewarmMonaco(): void {
  if (prewarmed || typeof document === "undefined") return
  prewarmed = true
  try {
    const host = document.createElement("div")
    host.setAttribute("aria-hidden", "true")
    host.style.cssText =
      "position:absolute;left:-99999px;top:0;width:320px;height:240px;overflow:hidden;pointer-events:none;"
    document.body.appendChild(host)
    const ed = monaco.editor.create(host, {
      value: "// prewarm\n",
      language: "plaintext",
      automaticLayout: false,
      minimap: { enabled: false },
      lineNumbers: "off",
      scrollbar: { vertical: "hidden", horizontal: "hidden" },
    })
    setTimeout(() => {
      try {
        ed.dispose()
        host.remove()
      } catch {
        /* dispose best-effort */
      }
    }, 0)
  } catch {
    // Intentionally ignored.
  }
}

if (typeof window !== "undefined") {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => void
  }
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(() => prewarmMonaco(), { timeout: 2500 })
  } else {
    setTimeout(prewarmMonaco, 1000)
  }
}

export { monaco }
