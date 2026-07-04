// Theme engine — applies an `Appearance` block (mode + preset + overrides + fonts + flags)
// to the document. Writes CSS variables on `:root`, toggles the `.dark` class for
// shadcn-style consumers, and exposes data-attributes for motion/diff/cursor/smoothing.
import {
  BUILTIN_PRESETS,
  TOKEN_TO_CSS_VAR,
  getPreset,
  type ThemeMode,
  type ThemePreset,
  type ThemeTokens,
} from "./theme-presets"
import { DEFAULT_MASCOT } from "./mascots"

export type Theme = "light" | "dark" | "system"
export type FontScale = "s" | "m" | "l" | "xl"

export type DiffStyle = "color" | "symbols"
export type ReduceMotion = "system" | "on" | "off"

export type Appearance = {
  mode: Theme
  lightPreset: string
  darkPreset: string
  // Per-preset color overrides — keyed by preset id (works for both light and dark).
  // Each preset keeps its own customization; switching presets does NOT erase
  // overrides on the other one. Returning to a customized preset re-applies them.
  customsByPreset?: Record<string, Partial<ThemeTokens>>
  // Legacy flat overrides — kept for backward compat with old settings files.
  // Migrated into `customsByPreset` at load time; new writes only update the map.
  customLight?: Partial<ThemeTokens>
  customDark?: Partial<ThemeTokens>
  uiFont: string
  codeFont: string
  uiFontSizePx: number
  codeFontSizePx: number
  contrastLight: number // 0-100, 50 = neutral
  contrastDark: number
  reduceMotion: ReduceMotion
  diffStyle: DiffStyle
  fontSmoothing: boolean
  pointerCursor: boolean
  mascotCharacter: string
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  lightPreset: "codezal-light",
  darkPreset: "codezal-dark",
  uiFont: "SF Pro Text",
  codeFont: "JetBrains Mono",
  uiFontSizePx: 14,
  codeFontSizePx: 13,
  contrastLight: 50,
  contrastDark: 50,
  reduceMotion: "system",
  diffStyle: "color",
  fontSmoothing: true,
  pointerCursor: false,
  mascotCharacter: DEFAULT_MASCOT,
}

function resolveMode(theme: Theme): ThemeMode {
  if (theme === "light" || theme === "dark") return theme
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

// Apply HSL-component contrast nudge to an "H S% L%" string. shift in [-25, +25].
function adjustContrast(hsl: string, shift: number): string {
  const m = hsl.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/)
  if (!m) return hsl
  const h = m[1]
  const s = m[2]
  const lNum = parseFloat(m[3])
  // Push lightness toward extremes — light themes get lighter bgs / darker text, vice versa
  const clamped = Math.max(0, Math.min(100, lNum + shift))
  return `${h} ${s}% ${clamped}%`
}

function writeTokens(tokens: ThemeTokens, contrast: number, mode: ThemeMode) {
  const root = document.documentElement
  // contrast: 50 = neutral, 0..49 = lower contrast, 51..100 = higher
  // Map to a small lightness shift (max ±15)
  const delta = ((contrast - 50) / 50) * 15
  // For dark mode, increasing contrast = darker bg + lighter text
  // For light mode, increasing contrast = lighter bg + darker text
  const bgShift = mode === "dark" ? -delta : delta
  const textShift = mode === "dark" ? delta : -delta

  for (const key of Object.keys(TOKEN_TO_CSS_VAR) as (keyof ThemeTokens)[]) {
    let v = tokens[key]
    if (key === "codezalLineRgb") {
      // Not HSL — write as-is
      root.style.setProperty(`--${TOKEN_TO_CSS_VAR[key]}`, v)
      continue
    }
    // Apply contrast nudge only to surface and text tokens — accents stay vivid
    const isSurface =
      key === "codezalBg" ||
      key === "codezalSidebar" ||
      key === "codezalPanel" ||
      key === "codezalPanel2" ||
      key === "codezalTitleBar" ||
      key === "codezalInput" ||
      key === "codezalChip" ||
      key === "codezalCodeBg" ||
      key === "codezalCodeChip" ||
      key === "background" ||
      key === "card" ||
      key === "popover" ||
      key === "secondary" ||
      key === "muted"
    const isText =
      key === "codezalText" ||
      key === "codezalTextDim" ||
      key === "codezalTextMute" ||
      key === "foreground"
    if (contrast !== 50) {
      if (isSurface) v = adjustContrast(v, bgShift)
      else if (isText) v = adjustContrast(v, textShift)
    }
    root.style.setProperty(`--${TOKEN_TO_CSS_VAR[key]}`, v)
  }
}

function mergeTokens(base: ThemeTokens, overrides?: Partial<ThemeTokens>): ThemeTokens {
  if (!overrides) return base
  return { ...base, ...overrides } as ThemeTokens
}

export function applyAppearance(appearance: Appearance, userPresets: ThemePreset[] = []): void {
  const root = document.documentElement
  const all = [...BUILTIN_PRESETS, ...userPresets]
  const resolved = resolveMode(appearance.mode)
  root.classList.toggle("dark", resolved === "dark")

  const presetId = resolved === "dark" ? appearance.darkPreset : appearance.lightPreset
  const preset = all.find((p) => p.id === presetId) ?? getPreset(presetId, resolved)
  const explicit = appearance.customsByPreset?.[presetId]
  const legacy = resolved === "dark" ? appearance.customDark : appearance.customLight
  const overrides = explicit ?? legacy
  const tokens = mergeTokens(preset.tokens, overrides)
  const contrast = resolved === "dark" ? appearance.contrastDark : appearance.contrastLight
  writeTokens(tokens, contrast, resolved)

  // Fonts — wrap names in quotes so multi-word families (e.g. "IBM Plex Mono")
  // are parsed as a single family rather than three separate ones.
  // Special tokens (system-ui, ui-monospace, -apple-system) must NOT be quoted.
  const quoteFamily = (name: string): string => {
    const trimmed = name.trim()
    if (!trimmed) return ""
    // CSS generic keywords + system tokens stay bare
    const bareTokens = /^(system-ui|ui-monospace|ui-sans-serif|ui-serif|ui-rounded|-apple-system|sans-serif|serif|monospace|cursive|fantasy)$/i
    if (bareTokens.test(trimmed)) return trimmed
    return `"${trimmed.replace(/"/g, "")}"`
  }
  root.style.setProperty("--codezal-ui-font", quoteFamily(appearance.uiFont || "SF Pro Text"))
  root.style.setProperty("--codezal-code-font", quoteFamily(appearance.codeFont || "JetBrains Mono"))
  root.style.setProperty("--codezal-ui-font-size", `${appearance.uiFontSizePx}px`)
  root.style.setProperty("--codezal-code-font-size", `${appearance.codeFontSizePx}px`)

  // Flags
  root.setAttribute("data-reduce-motion", appearance.reduceMotion)
  root.setAttribute("data-diff-style", appearance.diffStyle)
  root.setAttribute("data-font-smoothing", appearance.fontSmoothing ? "on" : "off")
  root.setAttribute("data-pointer-cursor", appearance.pointerCursor ? "on" : "off")
}

// Back-compat — older callers only pass Theme.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  root.classList.toggle("dark", isDark)
}

// system mode follower
export function watchSystemTheme(onChange: (isDark: boolean) => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addEventListener("change", handler)
  return () => mq.removeEventListener("change", handler)
}

// Tauri webview zoom — kept for the legacy fontScale path.
const FONT_SCALE_ZOOM: Record<FontScale, number> = {
  s: 0.9,
  m: 1.0,
  l: 1.1,
  xl: 1.2,
}

export async function applyFontScale(scale: FontScale | undefined): Promise<void> {
  const zoom = FONT_SCALE_ZOOM[scale ?? "m"]
  if (typeof document !== "undefined") {
    const root = document.documentElement
    root.style.setProperty("--tl-btn-left", `${88 / zoom}px`)
    root.style.setProperty("--tl-drag-left", `${124 / zoom}px`)
  }
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    await getCurrentWebviewWindow().setZoom(zoom)
  } catch (e) {
    console.warn("[font-scale] setZoom failed:", e)
  }
}
