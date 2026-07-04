//
//
//   const env = await rcfileEnv({ shortPrompt: true })
//   spawnPty({ ..., env })
import { invoke } from "@tauri-apps/api/core"
import { isWindows } from "@/lib/platform"

export async function rcfileEnv(opts: {
  shortPrompt: boolean
}): Promise<Record<string, string> | undefined> {
  if (!opts.shortPrompt) return undefined
  if (isWindows()) return undefined
  try {
    const dir = await invoke<string>("pty_ensure_rcfiles")
    return {
      ZDOTDIR: dir,
    }
  } catch (e) {
    console.warn("[terminal] rcfile yazılamadı, default prompt:", e)
    return undefined
  }
}
