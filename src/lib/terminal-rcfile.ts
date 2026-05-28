// Codezal terminal için özel shell rcfile'ları.
// Plugin-fs scope dotfile match problemi nedeniyle yazma işi Rust tarafında
// (pty_ensure_rcfiles) yapılır. Bu modül sadece env hazırlar.
//
// Kullanıcının ~/.zshrc dosyası DEĞİŞTİRİLMEZ — ZDOTDIR override sayesinde
// Codezal terminal'i farklı bir dizine bakar. Bu dizindeki .zshrc önce user
// config'ini source eder, sonra PROMPT'u kısaltır.
//
// Akış:
//   const env = await rcfileEnv({ shortPrompt: true })
//   spawnPty({ ..., env })
import { invoke } from "@tauri-apps/api/core"

// PTY spawn için env. shortPrompt=false ise undefined döner ve default shell
// davranışı (user'ın kendi .zshrc/PROMPT'u) kullanılır.
export async function rcfileEnv(opts: {
  shortPrompt: boolean
}): Promise<Record<string, string> | undefined> {
  if (!opts.shortPrompt) return undefined
  try {
    const dir = await invoke<string>("pty_ensure_rcfiles")
    return {
      ZDOTDIR: dir,
      // bash interactive --rcfile argümanı PTY shell komut satırından gelmiyor;
      // ENV/BASH_ENV interactive shell'de okunmaz. zsh için ZDOTDIR yeterli.
      // (bash kullanıcısı kısa prompt için PS1'i kendi .bashrc'sinde değiştirmeli.)
    }
  } catch (e) {
    console.warn("[terminal] rcfile yazılamadı, default prompt:", e)
    return undefined
  }
}
