// portable-pty cross-platform: Unix forkpty + Windows ConPTY.
//
//   const id = await invoke('pty_spawn', { args: { id, rows, cols, cwd, shell, env } })
//   listen<string>(`pty:data:${id}`, ev => term.write(ev.payload))
//   listen(`pty:exit:${id}`, () => term.write('\r\n[process exited]'))
//   await invoke('pty_write', { id, data: "ls\r" })
//   await invoke('pty_resize', { id, rows, cols })
//   await invoke('pty_kill', { id })

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(serde::Deserialize)]
pub struct PtySpawnArgs {
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    shell: Option<String>,
    env: Option<HashMap<String, String>>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    args: PtySpawnArgs,
) -> Result<String, String> {
    let PtySpawnArgs {
        id,
        rows,
        cols,
        cwd,
        shell,
        env,
    } = args;
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
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(extra) = env {
        for (k, v) in extra {
            cmd.env(k, v);
        }
    }
    #[cfg(unix)]
    {
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

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    if sessions.contains_key(&id) {
        let mut child = child;
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("pty zaten var: {}", id));
    }
    sessions.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    drop(sessions);

    let id_clone = id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let mut out = String::new();
                    loop {
                        match std::str::from_utf8(&carry) {
                            Ok(s) => {
                                out.push_str(s);
                                carry.clear();
                                break;
                            }
                            Err(e) => {
                                let valid = e.valid_up_to();
                                out.push_str(std::str::from_utf8(&carry[..valid]).unwrap_or(""));
                                match e.error_len() {
                                    Some(bad) => {
                                        out.push('\u{FFFD}');
                                        carry.drain(..valid + bad);
                                    }
                                    None => {
                                        carry.drain(..valid);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if !out.is_empty() {
                        let _ = app_clone.emit(&format!("pty:data:{}", id_clone), out);
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(mgr) = app_clone.try_state::<PtyManager>() {
            if let Ok(mut sessions) = mgr.sessions.lock() {
                if let Some(mut s) = sessions.remove(&id_clone) {
                    let _ = s.child.wait();
                }
            }
        }
        let _ = app_clone.emit(&format!("pty:exit:{}", id_clone), ());
    });

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
    session
        .writer
        .flush()
        .map_err(|e| format!("flush: {}", e))?;
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

pub fn kill_process_tree(root: u32) {
    if root <= 1 {
        return; // init/kernel pid'lerine asla dokunma
    }
    #[cfg(unix)]
    {
        let pids = collect_descendants(root);
        let strs: Vec<String> = pids.iter().map(|p| p.to_string()).collect();
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .args(&strs)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        std::thread::sleep(std::time::Duration::from_millis(200));
        // Hayatta kalanlara SIGKILL
        let _ = std::process::Command::new("kill")
            .arg("-KILL")
            .args(&strs)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &root.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(unix)]
fn collect_descendants(root: u32) -> Vec<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    if let Ok(out) = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid="])
        .output()
    {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let mut it = line.split_whitespace();
            if let (Some(a), Some(b)) = (it.next(), it.next()) {
                if let (Ok(pid), Ok(ppid)) = (a.parse::<u32>(), b.parse::<u32>()) {
                    children.entry(ppid).or_default().push(pid);
                }
            }
        }
    }
    let mut result = vec![root];
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        if let Some(kids) = children.get(&p) {
            for &k in kids {
                if !result.contains(&k) {
                    result.push(k);
                    stack.push(k);
                }
            }
        }
    }
    result
}

#[tauri::command]
pub fn proc_kill_tree(pid: u32) -> Result<(), String> {
    kill_process_tree(pid);
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        sessions.remove(&id)
    };
    if let Some(mut session) = session {
        if let Some(pid) = session.child.process_id() {
            kill_process_tree(pid);
        }
        let _ = session.child.kill();
        let _ = session.child.wait(); // zombie reap
    }
    Ok(())
}

/// Konum: $HOME/.codezal/shell/{.zshrc,.bashrc}
#[tauri::command]
pub fn pty_ensure_rcfiles() -> Result<String, String> {
    // Windows USERPROFILE, POSIX HOME — editors.rs pattern'i (tek strateji).
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_var).map_err(|_| format!("{} env yok", home_var))?;
    let mut dir = PathBuf::from(home);
    dir.push(".codezal");
    dir.push("shell");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;

    let zshrc = [
        "# Codezal terminal — auto-generated. Do not edit; toggle from Settings → Appearance.",
        "# Source user's real config first so aliases/PATH/functions stay available.",
        "ZDOTDIR_BACKUP=\"$ZDOTDIR\"",
        "unset ZDOTDIR",
        "[ -f \"$HOME/.zshrc\" ] && source \"$HOME/.zshrc\"",
        "export ZDOTDIR=\"$ZDOTDIR_BACKUP\"",
        "unset ZDOTDIR_BACKUP",
        "# Compact prompt: current dir + %",
        "PROMPT='%~ %# '",
        "RPROMPT=''",
        "# Hide zsh's inverse-video partial-line marker (`%`) in embedded terminals.",
        "PROMPT_EOL_MARK=''",
        "",
    ]
    .join("\n");

    let bashrc = [
        "# Codezal terminal — auto-generated. Do not edit; toggle from Settings → Appearance.",
        "[ -f \"$HOME/.bashrc\" ] && source \"$HOME/.bashrc\"",
        "# Compact prompt: current dir + $",
        "PS1='\\w \\$ '",
        "",
    ]
    .join("\n");

    let zshrc_path = dir.join(".zshrc");
    let bashrc_path = dir.join(".bashrc");
    fs::write(&zshrc_path, zshrc).map_err(|e| format!("write .zshrc: {}", e))?;
    fs::write(&bashrc_path, bashrc).map_err(|e| format!("write .bashrc: {}", e))?;

    Ok(dir.to_string_lossy().into_owned())
}
