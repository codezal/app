// PTY (pseudoterminal) yönetimi — gerçek interaktif shell.
// portable-pty cross-platform: Unix forkpty + Windows ConPTY.
//
// JS tarafı:
//   const id = await invoke('pty_spawn', { id, rows, cols, cwd, shell })
//   listen<string>(`pty:data:${id}`, ev => term.write(ev.payload))
//   listen(`pty:exit:${id}`, () => term.write('\r\n[process exited]'))
//   await invoke('pty_write', { id, data: "ls\r" })
//   await invoke('pty_resize', { id, rows, cols })
//   await invoke('pty_kill', { id })

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {}", e))?;

    // Shell tespit et — env $SHELL veya platform default
    let shell_path = shell.unwrap_or_else(|| {
        #[cfg(unix)]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
        #[cfg(windows)]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
    });
    let mut cmd = CommandBuilder::new(shell_path);
    if let Some(c) = cwd {
        cmd.cwd(c);
    }
    // Terminal env varları — renkli output için
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Login shell flag — gerekirse ekle (zsh, bash için)
    #[cfg(unix)]
    {
        // -l ile login shell başlat (rc dosyalarını oku) — kullanıcı PATH'ini al
        // Bu bash/zsh için işe yarar. Diğer shell'lerde sorun çıkarsa kaldırılır.
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn_command: {}", e))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {}", e))?;

    // Reader thread → stdout'u event olarak akıt
    let id_clone = id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // UTF-8 multi-byte ortada kırılabilir — from_utf8_lossy invalid byte'ları � ile değiştirir.
                    // Şimdilik basitlik için kabul; gerekirse UTF-8 buffer'ı eklenir.
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(&format!("pty:data:{}", id_clone), chunk);
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(&format!("pty:exit:{}", id_clone), ());
    });

    let session = PtySession {
        master: pair.master,
        writer,
        child,
    };
    state
        .sessions
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .insert(id.clone(), session);

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("pty bulunamadı: {}", id))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    session.writer.flush().map_err(|e| format!("flush: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("pty bulunamadı: {}", id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

