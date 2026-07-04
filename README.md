# Codezal

Codezal is an open-source desktop AI coding workspace for working with hosted
models, local models, tools, plugins, terminals, files, and long-running coding
sessions in one native app.

It is built with Tauri, React, TypeScript, Rust, and the Vercel AI SDK.

## Highlights

- Multi-provider chat with OpenAI, Anthropic, Google, DeepSeek, OpenRouter, and
  other AI SDK compatible providers.
- Local model support with platform-aware desktop builds.
- MCP tools, plugin support, hooks, and reusable skills.
- Multi-session workspace where background sessions can keep streaming.
- File-aware context, code viewing, terminal integration, and Git workflows.
- Local SQLite session persistence.
- macOS and Windows support.

## Status

Codezal is actively developed. The source code is open under Apache-2.0.
Official signed builds, updater artifacts, and marketplace curation are managed
by the Codezal maintainers.

## Development

Install dependencies:

```bash
npm install
```

Run the full desktop app:

```bash
npm run tauri dev
```

`npm run dev` starts only the Vite frontend. Use `npm run tauri dev` for normal
desktop development.

## Verification

Before opening a pull request, run:

```bash
npm test
npx eslint .
npx tsc --noEmit --ignoreDeprecations 5.0 -p tsconfig.app.json
```

## Build

Build the desktop app:

```bash
npm run tauri build
```

Official release helpers:

```bash
npm run build:mac:arm
npm run build:mac:intel
npm run build:win
npm run release:verify
```

## Project Layout

- `src/` - React app, UI components, stores, providers, tools, plugins, and
  business logic.
- `src-tauri/` - Tauri shell, Rust invoke handlers, PTY support, local services,
  signing, and bundle configuration.
- `tests/` - Vitest coverage for core logic.
- `scripts/` - release, versioning, icon, and verification utilities.

## Credentials

API keys are configured inside the app settings. Do not commit local environment
files, provider credentials, generated indexes, or workspace memory.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
