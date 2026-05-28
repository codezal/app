# Codezal — Project Guidelines

## Language

This project ships internationally but the maintainer is Turkish. Split:

- **Conversation with the user (this chat): Turkish.** Per the global
  rule in `~/.claude/CLAUDE.md`. Never reply to the user in English
  unless they explicitly request it.
- **Everything that ends up on disk or in the repo: English.**
  - Code comments (`//`, `/* */`, JSDoc, docstrings) — English.
  - Commit messages — English, Conventional Commits prefixes
    (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `ui:` …).
  - PR titles and descriptions — English.
  - Inline strings the user does NOT see (logs, error messages thrown
    to developers, `console.warn` text) — English.
- **User-facing UI text:** routed through `src/lib/i18n` only. Default
  locale is `en` (`src/lib/i18n/types.ts`); Turkish stays available as
  a user-selectable language alongside the other 17 locales. Do not
  hardcode user-visible strings in any single language.
- **Legacy Turkish comments** in older files are not bulk-translated;
  translate them opportunistically when touching the surrounding code.

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
