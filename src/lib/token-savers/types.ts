// Token-saver feature settings — three independent toggles.
// Persisted on Settings.tokenSavers (optional for back-compat with older settings.json).

export type BriefModeLevel = "lite" | "full" | "ultra"

export type BriefModeSettings = {
  enabled: boolean
  level: BriefModeLevel
}

// Per-command-kind toggles. A user may want shell output filtered for build
// noise but keep git output raw, etc.
export type CompactOutputFilters = {
  git: boolean
  test: boolean
  build: boolean
  grep: boolean
  lint: boolean
  pkg: boolean
  generic: boolean
}

export type CompactOutputSettings = {
  enabled: boolean
  filters: CompactOutputFilters
}

export type CodeMapSettings = {
  enabled: boolean
  autoReindex: boolean
  // Subset of supported languages the user wants indexed. Empty = all known.
  languages: string[]
}

export type HistoryHygieneSettings = {
  enabled: boolean
  maxLines: number
  maxBytes: number
}

export type TokenSaverSettings = {
  briefMode: BriefModeSettings
  compactOutput: CompactOutputSettings
  codeMap: CodeMapSettings
  deferMcpTools?: boolean
  compressToolDescriptions?: boolean
  historyHygiene?: HistoryHygieneSettings
}

export const DEFAULT_TOKEN_SAVERS: TokenSaverSettings = {
  briefMode: { enabled: false, level: "full" },
  compactOutput: {
    enabled: false,
    filters: {
      git: true,
      test: true,
      build: true,
      grep: true,
      lint: true,
      pkg: true,
      generic: true,
    },
  },
  codeMap: { enabled: true, autoReindex: true, languages: [] },
  deferMcpTools: true,
  compressToolDescriptions: false,
  historyHygiene: { enabled: false, maxLines: 200, maxBytes: 16_384 },
}
