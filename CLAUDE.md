# Codezal — Project Guidelines

## Language

**This project is fully English.** It overrides the global "Turkish
communication" rule in `~/.claude/CLAUDE.md`.

- All conversation: English.
- All code comments (`//`, `/* */`, JSDoc, docstrings): English.
- All commit messages: English, following Conventional Commits
  (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `ui:` …).
- All PR titles and descriptions: English.
- UI default locale: `en` (see `src/lib/i18n/types.ts`). Turkish
  remains available as a user-selectable language alongside the
  other 17 locales.
- Legacy Turkish comments in older files are not bulk-translated;
  prefer translating them when you touch the surrounding code.

## Plugin marketplace

Plugins distributed through `https://github.com/codezal/marketplace`
target an international audience. All plugin content (manifests,
agent prompts, slash command descriptions, READMEs, NOTICE files)
is English.

Plugin agents should reply in the **user's language** at runtime —
default to English when uncertain, but never lock the response
language to English.

## Codebase layout (short)

- `src/lib/providers/` — LLM provider adapters (one file per provider)
- `src/lib/commands/` — slash commands (builtin + user + plugin)
- `src/lib/agents/` — agents (parse + user + plugin + seed)
- `src/lib/skills/` — skills (parse + user + plugin)
- `src/lib/mcp.ts` — MCP transport + plugin MCP registry
- `src/lib/hooks.ts` — hook runner + plugin hook registry
- `src/lib/plugins/` — plugin system core (types, permissions,
  manifest, installed, loader, marketplace, install)
- `src/components/` — UI
- `src-tauri/` — Rust shell + Tauri capabilities
- Apparent globals (`commands.ts`, `agents.ts`, `skills.ts`,
  `providers.ts`) are re-export shims left for backward
  compatibility; new code should import from the directory modules.

## Conventions

- TypeScript strict; no `any` without a reason.
- Tailwind classes inline; no CSS-in-JS.
- Zustand stores under `src/store/`.
- File names: `kebab-case.ts` for libs, `PascalCase.tsx` for React.
- `tsc` check before commit: `npx tsc --noEmit --ignoreDeprecations 5.0 -p tsconfig.app.json`.
- Don't bulk-rename or reformat files you didn't otherwise touch.
- Per-agent file ownership rule still applies (see global CLAUDE.md
  section 6) — `git add` paths explicitly, never `git add .` or `-A`.

## Caveman mode

Global caveman mode (terse fragments, no filler) still applies. It
only changes presentation style, not the project language.
