import type { HarnessKind } from "./types"

export type HistoryOS = "macos" | "windows" | "linux"

export function normalizeOS(platform: string): HistoryOS {
  if (platform === "macos") return "macos"
  if (platform === "windows") return "windows"
  return "linux"
}

export function joinPath(os: HistoryOS, ...parts: string[]): string {
  const sep = os === "windows" ? "\\" : "/"
  return parts.filter((p) => p.length > 0).join(sep)
}

export function harnessRoots(
  harness: HarnessKind,
  home: string,
  os: HistoryOS,
  env: Record<string, string | undefined> = {},
): string[] {
  const h = home.replace(/[\\/]+$/, "")
  switch (harness) {
    case "claude-code":
      // Hem macOS/Linux hem Windows: ~/.claude/projects/<enc-path>/<uuid>.jsonl
      return [joinPath(os, h, ".claude", "projects")]

    case "codex":
      // ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl + archived_sessions/
      return [
        joinPath(os, h, ".codex", "sessions"),
        joinPath(os, h, ".codex", "archived_sessions"),
      ]

    case "opencode": {
      // Linux/macOS: $XDG_DATA_HOME/opencode (default ~/.local/share/opencode)
      // Windows: %LOCALAPPDATA%\opencode (config ise %APPDATA%, ama veri Local'de)
      if (os === "windows") {
        const localApp = env.LOCALAPPDATA || env.APPDATA || joinPath(os, h, "AppData", "Local")
        return [joinPath(os, localApp.replace(/[\\/]+$/, ""), "opencode")]
      }
      const dataHome = env.XDG_DATA_HOME || joinPath(os, h, ".local", "share")
      return [joinPath(os, dataHome.replace(/[\\/]+$/, ""), "opencode")]
    }

    case "cursor": {
      if (os === "macos") {
        return [joinPath(os, h, "Library", "Application Support", "Cursor", "User")]
      }
      if (os === "windows") {
        const app = (env.APPDATA || joinPath(os, h, "AppData", "Roaming")).replace(/[\\/]+$/, "")
        return [joinPath(os, app, "Cursor", "User")]
      }
      const cfg = (env.XDG_CONFIG_HOME || joinPath(os, h, ".config")).replace(/[\\/]+$/, "")
      return [joinPath(os, cfg, "Cursor", "User")]
    }
  }
}
