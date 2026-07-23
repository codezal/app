import { useEffect, useState } from "react"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { Select } from "@/components/Select"
import { Mascot } from "@/components/Mascot"
import { MASCOT_CHARACTERS, MASCOT_STATES, MASCOT_NONE, DEFAULT_MASCOT, isMascotEnabled } from "@/lib/mascots"
import { DEFAULT_APPEARANCE, type Appearance, type DiffStyle, type ReduceMotion, type FontScale } from "@/lib/theme"
import { BUILTIN_PRESETS, PICKABLE_TOKENS, presetsForMode, type ThemePreset, type ThemeTokens, type ThemeMode } from "@/lib/theme-presets"
import { loadUserThemes, presetToJson, jsonToPreset, saveUserTheme } from "@/lib/theme-loader"
import { hslToHex, hexToHsl } from "@/lib/color-utils"
import { Section, Row, Toggle, Segmented } from "./primitives"

const UI_FONTS: { value: string; label: string }[] = [
  { value: "SF Pro Text", label: "SF Pro" },            // macOS/iOS system (Apple)
  { value: "Manrope", label: "Manrope" },               // Google Fonts
  { value: "IBM Plex Sans", label: "IBM Plex Sans" },   // Google Fonts
  { value: "Inter", label: "Inter" },                    // Google Fonts
  { value: "Geist", label: "Geist" },                    // Google Fonts
  { value: "Roboto", label: "Roboto" },                  // Google Fonts
  { value: "system-ui", label: "System default" },       // CSS keyword
  { value: "-apple-system", label: "Apple system" },     // CSS keyword (macOS/iOS)
  { value: "Segoe UI", label: "Segoe UI" },              // Windows system
  { value: "Helvetica Neue", label: "Helvetica Neue" },  // macOS system
]

const CODE_FONTS: { value: string; label: string }[] = [
  { value: "IBM Plex Mono", label: "IBM Plex Mono" },    // Google Fonts
  { value: "JetBrains Mono", label: "JetBrains Mono" },  // Google Fonts
  { value: "Fira Code", label: "Fira Code" },            // Google Fonts
  { value: "Cascadia Code", label: "Cascadia Code" },    // Google Fonts
  { value: "SF Mono", label: "SF Mono" },                // macOS system
  { value: "Menlo", label: "Menlo" },                    // macOS system
  { value: "Monaco", label: "Monaco" },                  // macOS system
  { value: "Consolas", label: "Consolas" },              // Windows system
  { value: "ui-monospace", label: "System monospace" },  // CSS keyword
]

export function AppearanceTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const appearance: Appearance = settings.appearance ?? DEFAULT_APPEARANCE
  const [userThemes, setUserThemes] = useState<ThemePreset[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const customSuffix = t("settings.drawer.appearance.customSuffix")

  const tokenLabel: Record<keyof ThemeTokens, string> = {
    codezalAccent: t("settings.drawer.appearance.tokenAccent"),
    codezalBg: t("settings.drawer.appearance.tokenBackground"),
    codezalText: t("settings.drawer.appearance.tokenForeground"),
    codezalTextDim: t("settings.drawer.appearance.tokenForegroundDim"),
    codezalTextMute: t("settings.drawer.appearance.tokenForegroundMute"),
    codezalPanel: t("settings.drawer.appearance.tokenPanel"),
    codezalSidebar: t("settings.drawer.appearance.tokenSidebar"),
    codezalChip: t("settings.drawer.appearance.tokenChip"),
    codezalDiffAdd: t("settings.drawer.appearance.tokenDiffAdd"),
    codezalDiffDel: t("settings.drawer.appearance.tokenDiffDel"),
  } as Record<keyof ThemeTokens, string>

  useEffect(() => {
    void loadUserThemes().then(setUserThemes)
  }, [])

  function patch(p: Partial<Appearance>) {
    const next: Appearance = { ...appearance, ...p }
    void update({ appearance: next, theme: next.mode })
  }

  const resolvedMode: ThemeMode =
    appearance.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance.mode

  const allPresets = [...BUILTIN_PRESETS, ...userThemes]
  const lightPresets = presetsForMode("light", allPresets)
  const darkPresets = presetsForMode("dark", allPresets)
  const activeLightPreset =
    lightPresets.find((p) => p.id === appearance.lightPreset) ?? BUILTIN_PRESETS[0]
  const activeDarkPreset =
    darkPresets.find((p) => p.id === appearance.darkPreset) ?? BUILTIN_PRESETS[1]
  const activePreset = resolvedMode === "dark" ? activeDarkPreset : activeLightPreset
  const customsByPreset = appearance.customsByPreset ?? {}
  const overrides = customsByPreset[activePreset.id] ?? {}
  const customLightActive =
    Object.keys(customsByPreset[activeLightPreset.id] ?? {}).length > 0
  const customDarkActive =
    Object.keys(customsByPreset[activeDarkPreset.id] ?? {}).length > 0
  // Sentinel option id used when overrides are active — selecting it is a no-op.
  const CUSTOM_LIGHT_ID = "__custom-light__"
  const CUSTOM_DARK_ID = "__custom-dark__"

  function getActiveToken(key: keyof ThemeTokens): string {
    return (overrides[key] as string | undefined) ?? activePreset.tokens[key]
  }

  function setActiveToken(key: keyof ThemeTokens, hsl: string) {
    const prev = customsByPreset[activePreset.id] ?? {}
    patch({
      customsByPreset: {
        ...customsByPreset,
        [activePreset.id]: { ...prev, [key]: hsl },
      },
    })
  }

  function resetOverrides() {
    const next = { ...customsByPreset }
    delete next[activePreset.id]
    patch({ customsByPreset: next })
  }

  function exportCurrent() {
    // Strip a trailing "(custom)" so re-exports don't accumulate suffixes;
    // the dropdown already appends "(custom)" for non-builtin presets at render time.
    const baseName = activePreset.name.replace(/\s*\(custom\)\s*$/i, "")
    const merged: ThemePreset = {
      // eslint-disable-next-line react-hooks/purity
      id: `${activePreset.id}-custom-${Date.now()}`,
      name: baseName,
      mode: resolvedMode,
      tokens: { ...activePreset.tokens, ...overrides } as ThemeTokens,
    }
    const json = presetToJson(merged)
    void navigator.clipboard.writeText(json).catch(() => {})
    // Persist a copy under ~/.codezal/themes/ so it can be re-selected later
    void saveUserTheme(merged).then(async () => {
      const next = await loadUserThemes()
      setUserThemes(next)
    })
  }

  async function onImport(file: File) {
    try {
      const text = await file.text()
      const preset = jsonToPreset(text, file.name.replace(/\.json$/i, ""))
      if (!preset) {
        setImportError(t("settings.drawer.appearance.invalidThemeJson"))
        return
      }
      await saveUserTheme(preset)
      const next = await loadUserThemes()
      setUserThemes(next)
      setImportError(null)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("settings.drawer.appearance.importFailed"))
    }
  }

  const localizedMode =
    resolvedMode === "dark"
      ? t("settings.drawer.appearance.modeDark")
      : t("settings.drawer.appearance.modeLight")

  const zoomLabel = (sz: FontScale): string => {
    switch (sz) {
      case "s":
        return t("settings.drawer.appearance.zoomSmall")
      case "m":
        return t("settings.drawer.appearance.zoomMedium")
      case "l":
        return t("settings.drawer.appearance.zoomLarge")
      case "xl":
        return t("settings.drawer.appearance.zoomXL")
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t("settings.drawer.appearance.displayTitle")}>
        <div className="border-b border-codezal-hair pb-3 pt-1">
          <div className="mb-2 text-base font-medium text-codezal-text">
            {t("settings.drawer.appearance.modeTitle")}
          </div>
          <Segmented
            value={appearance.mode}
            options={[
              { value: "light", label: t("settings.drawer.appearance.modeLight") },
              { value: "dark", label: t("settings.drawer.appearance.modeDark") },
              { value: "system", label: t("settings.drawer.appearance.modeSystem") },
            ]}
            onChange={(mode) => patch({ mode })}
          />
        </div>

        <div className="border-b border-codezal-hair py-3">
          <div className="mb-1 text-base font-medium text-codezal-text">
            {t("settings.drawer.appearance.zoomTitle")}
          </div>
          <p className="mb-2 text-base text-codezal-mute">
            {t("settings.drawer.appearance.zoomDesc")}
          </p>
          <Segmented<FontScale>
            value={settings.fontScale ?? "m"}
            options={(["s", "m", "l", "xl"] as FontScale[]).map((sz) => ({
              value: sz,
              label: zoomLabel(sz),
            }))}
            onChange={(sz) => void update({ fontScale: sz })}
          />
        </div>

        <div className="pt-3">
          <div className="mb-2 text-base font-medium text-codezal-text">
            {t("settings.drawer.appearance.themePresetsTitle")}
          </div>
          <Row
            label={t("settings.drawer.appearance.lightThemeLabel")}
            description={t("settings.drawer.appearance.lightThemeDesc")}
          >
          <Select
            value={customLightActive ? CUSTOM_LIGHT_ID : appearance.lightPreset}
            onChange={(next) => {
              if (next === CUSTOM_LIGHT_ID) return
              patch({ lightPreset: next })
            }}
            wrapperClassName="inline-block w-auto"
            triggerClassName="w-auto"
            options={[
              ...(customLightActive
                ? [
                    {
                      value: CUSTOM_LIGHT_ID,
                      label: `${activeLightPreset.name.replace(/\s*\(custom\)\s*$/i, "")} (${customSuffix})`,
                    },
                  ]
                : []),
              ...lightPresets.map((p) => ({
                value: p.id,
                label:
                  p.name.replace(/\s*\(custom\)\s*$/i, "") +
                  (p.builtin === false ? ` (${customSuffix})` : ""),
              })),
            ]}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.darkThemeLabel")}
          description={t("settings.drawer.appearance.darkThemeDesc")}
        >
          <Select
            value={customDarkActive ? CUSTOM_DARK_ID : appearance.darkPreset}
            onChange={(next) => {
              if (next === CUSTOM_DARK_ID) return
              patch({ darkPreset: next })
            }}
            wrapperClassName="inline-block w-auto"
            triggerClassName="w-auto"
            options={[
              ...(customDarkActive
                ? [
                    {
                      value: CUSTOM_DARK_ID,
                      label: `${activeDarkPreset.name.replace(/\s*\(custom\)\s*$/i, "")} (${customSuffix})`,
                    },
                  ]
                : []),
              ...darkPresets.map((p) => ({
                value: p.id,
                label:
                  p.name.replace(/\s*\(custom\)\s*$/i, "") +
                  (p.builtin === false ? ` (${customSuffix})` : ""),
              })),
            ]}
          />
        </Row>
        </div>
      </Section>

      <Section title={t("settings.drawer.appearance.customColorsTitle", { mode: localizedMode })}>
        <p className="mb-2 text-base text-codezal-mute">
          {t("settings.drawer.appearance.customColorsHint")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PICKABLE_TOKENS.map(({ key, label }) => {
            const hsl = getActiveToken(key)
            const hex = hslToHex(hsl)
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-md border border-codezal bg-codezal-panel px-2.5 py-1.5"
              >
                <span className="text-base text-codezal-text">{tokenLabel[key] ?? label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setActiveToken(key, hexToHsl(e.target.value))}
                    className="h-6 w-8 cursor-pointer rounded border border-codezal bg-transparent"
                  />
                  <HexInput
                    value={hex}
                    onCommit={(next) => setActiveToken(key, hexToHsl(next))}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {Object.keys(overrides).length > 0 && (
          <button
            type="button"
            onClick={resetOverrides}
            className="mt-2 text-base text-codezal-accent hover:underline"
          >
            {t("settings.drawer.appearance.resetCustomColors")}
          </button>
        )}
      </Section>

      <Section title={t("settings.drawer.appearance.typographyTitle")}>
        <Row
          label={t("settings.drawer.appearance.uiFontLabel")}
          description={t("settings.drawer.appearance.uiFontDesc")}
        >
          <Select
            value={UI_FONTS.some((f) => f.value === appearance.uiFont) ? appearance.uiFont : "SF Pro Text"}
            onChange={(v) => patch({ uiFont: v })}
            wrapperClassName="inline-block w-auto"
            triggerClassName="w-auto"
            triggerStyle={{ fontFamily: `"${appearance.uiFont}", system-ui, sans-serif` }}
            options={UI_FONTS.map((f) => ({
              value: f.value,
              label: f.label,
              style: { fontFamily: `"${f.value}", system-ui, sans-serif` },
            }))}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.codeFontLabel")}
          description={t("settings.drawer.appearance.codeFontDesc")}
        >
          <Select
            value={CODE_FONTS.some((f) => f.value === appearance.codeFont) ? appearance.codeFont : "JetBrains Mono"}
            onChange={(v) => patch({ codeFont: v })}
            wrapperClassName="inline-block w-auto"
            triggerClassName="w-auto"
            triggerStyle={{ fontFamily: `"${appearance.codeFont}", monospace` }}
            options={CODE_FONTS.map((f) => ({
              value: f.value,
              label: f.label,
              style: { fontFamily: `"${f.value}", monospace` },
            }))}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.codeFontSizeLabel")}
          description={t("settings.drawer.appearance.pixelsHint")}
        >
          <NumberInput
            value={appearance.codeFontSizePx}
            min={9}
            max={20}
            onChange={(v) => patch({ codeFontSizePx: v })}
            suffix="px"
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.mascotTitle")}>
        <Row
          label={t("settings.drawer.appearance.mascotLabel")}
          description={t("settings.drawer.appearance.mascotDesc")}
        >
          <Select
            value={
              appearance.mascotCharacter === MASCOT_NONE ||
              MASCOT_CHARACTERS.some((c) => c.id === appearance.mascotCharacter)
                ? appearance.mascotCharacter
                : DEFAULT_MASCOT
            }
            onChange={(v) => patch({ mascotCharacter: v })}
            wrapperClassName="inline-block w-auto"
            triggerClassName="w-auto"
            options={[
              { value: MASCOT_NONE, label: t("settings.drawer.appearance.mascotNone") },
              ...MASCOT_CHARACTERS.map((c) => ({ value: c.id, label: c.label })),
            ]}
          />
        </Row>
        {isMascotEnabled(appearance.mascotCharacter) && (
          <div className="flex items-end gap-3 px-1 pt-1">
            {MASCOT_STATES.map((st) => (
              <Mascot key={st} state={st} size={64} />
            ))}
          </div>
        )}
      </Section>

      <Section title={t("settings.drawer.appearance.contrastTitle")}>
        <Row
          label={t("settings.drawer.appearance.lightContrastLabel")}
          description={t("settings.drawer.appearance.contrastDesc")}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={appearance.contrastLight}
            onChange={(e) => patch({ contrastLight: parseInt(e.target.value, 10) })}
            className="w-48"
          />
          <span className="ml-2 text-base text-codezal-mute">{appearance.contrastLight}</span>
        </Row>
        <Row
          label={t("settings.drawer.appearance.darkContrastLabel")}
          description={t("settings.drawer.appearance.contrastDesc")}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={appearance.contrastDark}
            onChange={(e) => patch({ contrastDark: parseInt(e.target.value, 10) })}
            className="w-48"
          />
          <span className="ml-2 text-base text-codezal-mute">{appearance.contrastDark}</span>
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.motionTitle")}>
        <Row
          label={t("settings.drawer.appearance.reduceMotionLabel")}
          description={t("settings.drawer.appearance.reduceMotionDesc")}
        >
          <Segmented<ReduceMotion>
            value={appearance.reduceMotion}
            options={[
              { value: "system", label: t("settings.drawer.appearance.modeSystem") },
              { value: "on", label: t("settings.drawer.appearance.reduceMotionOn") },
              { value: "off", label: t("settings.drawer.appearance.reduceMotionOff") },
            ]}
            onChange={(v) => patch({ reduceMotion: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.pointerCursorLabel")}
          description={t("settings.drawer.appearance.pointerCursorDesc")}
        >
          <Toggle
            label={t("settings.drawer.appearance.pointerCursorLabel")}
            checked={appearance.pointerCursor}
            onChange={(v) => patch({ pointerCursor: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.fontSmoothingLabel")}
          description={t("settings.drawer.appearance.fontSmoothingDesc")}
        >
          <Toggle
            label={t("settings.drawer.appearance.fontSmoothingLabel")}
            checked={appearance.fontSmoothing}
            onChange={(v) => patch({ fontSmoothing: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.diffDisplayTitle")}>
        <Row
          label={t("settings.drawer.appearance.diffMarkersLabel")}
          description={t("settings.drawer.appearance.diffMarkersDesc")}
        >
          <Segmented<DiffStyle>
            value={appearance.diffStyle}
            options={[
              { value: "color", label: t("settings.drawer.appearance.diffColor") },
              { value: "symbols", label: "+/-" },
            ]}
            onChange={(v) => patch({ diffStyle: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.importExportTitle")}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-codezal bg-codezal-panel px-3 py-1.5 text-base text-codezal-text hover:bg-codezal-panel-2">
            {t("settings.drawer.appearance.importTheme")}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onImport(file)
                e.target.value = ""
              }}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={exportCurrent}
            className="rounded-md border border-codezal bg-codezal-panel px-3 py-1.5 text-base text-codezal-text hover:bg-codezal-panel-2"
          >
            {t("settings.drawer.appearance.exportCurrent")}
          </button>
        </div>
        <p className="mt-2 text-base text-codezal-mute">
          {t("settings.drawer.appearance.userThemesHint")}
        </p>
        {importError && (
          <p className="mt-2 text-base text-destructive">{importError}</p>
        )}
      </Section>
    </div>
  )
}

// Editable hex color input. Accepts #rgb, #rrggbb (with or without #).
// Commits live on every keystroke as soon as the draft is a valid hex —
// invalid intermediate states keep the picker's previous color. Esc reverts.
function HexInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (hex: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Re-sync when external value changes (e.g. preset switch, reset).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value)
  }, [value])

  function normalize(raw: string): string | null {
    const v = raw.trim().replace(/^#/, "")
    if (/^[0-9a-f]{3}$/i.test(v)) {
      const r = v[0], g = v[1], b = v[2]
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toLowerCase()
    return null
  }

  function handleChange(next: string) {
    setDraft(next)
    const hex = normalize(next)
    if (hex && hex.toLowerCase() !== value.toLowerCase()) {
      onCommit(hex)
    }
  }

  function commitOrRevert() {
    const hex = normalize(draft)
    if (hex) setDraft(hex.toUpperCase())
    else setDraft(value)
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={commitOrRevert}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === "Escape") {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="w-[78px] rounded-md border border-codezal bg-codezal-input px-2 py-1 font-mono text-base uppercase tracking-tight text-codezal-text focus:border-codezal-accent focus:outline-none"
    />
  )
}

function NumberInput({
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  suffix?: string
}) {
  // Draft state so the user can clear the input and type intermediate digits
  // (e.g. typing "1" then "8" without being clamped to min on the first digit).
  // Commit on blur or Enter; Esc reverts.
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(value))
  }, [value])

  function commit(raw: string) {
    if (raw.trim() === "") {
      setDraft(String(value))
      return
    }
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, n))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === "Escape") {
            setDraft(String(value))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-16 rounded-md border border-codezal bg-codezal-input px-2 py-1 text-right text-base text-codezal-text"
      />
      {suffix && <span className="text-base text-codezal-mute">{suffix}</span>}
    </div>
  )
}

