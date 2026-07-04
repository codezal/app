import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

const cmTheme = EditorView.theme({
  "&": {
    color: "hsl(var(--codezal-text))",
    backgroundColor: "transparent",
    height: "100%",
    fontSize: "var(--codezal-code-font-size, 13px)",
  },
  ".cm-scroller": {
    fontFamily:
      'var(--codezal-code-font), "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    lineHeight: "1.65",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "hsl(var(--codezal-text))",
    padding: "12px 0",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "hsl(var(--codezal-text))" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "hsl(var(--codezal-accent) / 0.25)",
    },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "hsl(var(--codezal-text-mute) / 0.6)",
    border: "none",
    borderRight: "1px solid hsl(var(--codezal-border) / 0.6)",
  },
  ".cm-activeLine": { backgroundColor: "hsl(var(--codezal-panel-2) / 0.4)" },
  ".cm-activeLineGutter": { backgroundColor: "hsl(var(--codezal-panel-2) / 0.5)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "hsl(var(--codezal-panel-2))",
    border: "none",
    color: "hsl(var(--codezal-text-mute))",
  },
  ".cm-searchMatch": {
    backgroundColor: "hsl(var(--codezal-accent) / 0.28)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "hsl(var(--codezal-accent) / 0.6)",
  },
  ".cm-panels": {
    backgroundColor: "hsl(var(--codezal-panel-2))",
    color: "hsl(var(--codezal-text))",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label":
    {
      fontSize: "12px",
    },
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--codezal-panel-2))",
    border: "1px solid hsl(var(--codezal-border) / 0.4)",
    borderRadius: "6px",
    color: "hsl(var(--codezal-text))",
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "hsl(var(--codezal-border) / 0.4)",
    borderBottomColor: "hsl(var(--codezal-border) / 0.4)",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "hsl(var(--codezal-panel-2))",
    borderBottomColor: "hsl(var(--codezal-panel-2))",
  },
})

const cmHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--cm-comment)", fontStyle: "italic" },
  {
    tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier],
    color: "var(--cm-keyword)",
  },
  { tag: [t.bool, t.null, t.atom], color: "var(--cm-keyword)" },
  { tag: [t.typeName, t.className, t.namespace, t.macroName], color: "var(--cm-type)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))],
    color: "var(--cm-func)",
  },
  { tag: [t.string, t.special(t.string), t.character, t.attributeValue], color: "var(--cm-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--cm-number)" },
  { tag: [t.tagName, t.meta, t.attributeName], color: "var(--cm-number)" },
  { tag: [t.regexp, t.escape], color: "var(--cm-regexp)" },
  { tag: [t.heading], fontWeight: "600", color: "var(--cm-type)" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--cm-string)", textDecoration: "underline" },
  { tag: [t.invalid], color: "var(--cm-regexp)" },
])

export const cmThemeExtensions: Extension[] = [cmTheme, syntaxHighlighting(cmHighlight)]
