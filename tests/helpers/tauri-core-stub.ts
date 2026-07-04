// Test stub for `@tauri-apps/api/core`.
//
// The node test environment has no Tauri runtime, so importing the real module
// fails to resolve (ERR_LOAD_URL). Modules under test that reach the Rust side
// through `invoke` (env-reader, secret-store) only need it to be loadable —
// their callers already treat a failed/empty invoke as "not available". This
// stub returns null so those paths exercise their fallback behaviour.
export async function invoke<T = unknown>(): Promise<T> {
  return null as T
}
