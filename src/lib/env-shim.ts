// Browser shims for Node globals that some dependencies (notably
// google-auth-library, pulled in by the Google provider) expect to exist at
// import time. Without these, the first Google-provider use crashes in the
// WebView with "process is not defined" / "global is not defined".
//
// This MUST run before any module that transitively imports those deps. It is
// imported first in main.tsx so it lands in the main bundle and executes before
// anything else. Kept as a bundled module (not an inline <script> in index.html)
// because the production CSP `script-src` has no 'unsafe-inline' — an inline
// shim would be silently blocked in release builds while appearing to work in
// dev (devCsp allows 'unsafe-inline').
const w = window as unknown as {
  process?: { env: Record<string, string | undefined> }
  global?: unknown
}

if (!w.process) w.process = { env: {} }
if (!w.global) w.global = window

export {}
