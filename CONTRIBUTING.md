# Contributing to Codezal

Thanks for helping improve Codezal.

## Development Setup

```bash
npm install
npm run tauri dev
```

Use `npm run tauri dev` for the full desktop app. `npm run dev` starts only the
Vite frontend.

## Checks

Run focused checks for the area you changed. Before opening a pull request, run:

```bash
npm test
npx eslint .
npx tsc --noEmit --ignoreDeprecations 5.0 -p tsconfig.app.json
```

## Pull Requests

- Keep changes focused and easy to review.
- Match the existing code style and architecture.
- Support both macOS and Windows.
- Add or update tests when behavior changes.
- Keep user-facing strings in `src/lib/i18n`.
- Do not commit local credentials, generated build output, or personal config.

## Releases

Official releases, signing keys, updater manifests, and marketplace curation are
handled by the Codezal maintainers.
