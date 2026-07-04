import type { Extension } from "@codemirror/state"
import { StreamLanguage, type StreamParser } from "@codemirror/language"
import { javascript } from "@codemirror/lang-javascript"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { go } from "@codemirror/lang-go"
import { java } from "@codemirror/lang-java"
import { php } from "@codemirror/lang-php"
import { sql } from "@codemirror/lang-sql"
import { xml } from "@codemirror/lang-xml"
import { cpp } from "@codemirror/lang-cpp"
import { yaml } from "@codemirror/lang-yaml"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { swift } from "@codemirror/legacy-modes/mode/swift"
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile"
import { properties } from "@codemirror/legacy-modes/mode/properties"
import { kotlin } from "@codemirror/legacy-modes/mode/clike"

const stream = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser)

const BY_EXT: Record<string, () => Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  json: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  css: () => css(),
  scss: () => css(),
  html: () => html(),
  xml: () => xml(),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  kt: () => stream(kotlin),
  php: () => php(),
  sql: () => sql(),
  yml: () => yaml(),
  yaml: () => yaml(),
  c: () => cpp(),
  h: () => cpp(),
  cpp: () => cpp(),
  hpp: () => cpp(),
  sh: () => stream(shell),
  bash: () => stream(shell),
  zsh: () => stream(shell),
  rb: () => stream(ruby),
  toml: () => stream(toml),
  swift: () => stream(swift),
  dockerfile: () => stream(dockerFile),
  env: () => stream(properties),
  ini: () => stream(properties),
}

export function langExtension(path: string): Extension {
  const base = path.toLowerCase().split(/[\\/]/).pop() ?? ""
  if (base === "dockerfile") return stream(dockerFile)
  const m = base.match(/\.([a-z0-9]+)$/)
  if (!m) return []
  const make = BY_EXT[m[1]]
  return make ? make() : []
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx)$/i.test(path)
}
