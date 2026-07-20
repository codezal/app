use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

fn find_in_dirs(dirs: &[PathBuf], cmd: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(|s| s.to_string())
        .collect();
    #[cfg(not(windows))]
    let exts: Vec<String> = vec![String::new()];

    for dir in dirs {
        for ext in &exts {
            let candidate = dir.join(format!("{cmd}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn which(cmd: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&paths).collect();
    find_in_dirs(&dirs, cmd)
}

#[cfg(windows)]
fn bundled_git_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let root = match app.path().resource_dir() {
        Ok(p) => p.join("git"),
        Err(_) => return Vec::new(),
    };
    ["cmd", "mingw64/bin", "usr/bin", "bin"]
        .iter()
        .map(|s| root.join(s))
        .filter(|p| p.is_dir())
        .collect()
}

#[cfg(not(windows))]
fn bundled_git_dirs(_app: &AppHandle) -> Vec<PathBuf> {
    Vec::new()
}

#[tauri::command]
pub fn os_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub fn resolve_program(app: AppHandle, name: String) -> Option<String> {
    let bundled = bundled_git_dirs(&app);
    if let Some(p) = find_in_dirs(&bundled, &name) {
        return Some(p.to_string_lossy().into_owned());
    }
    let login = login_path(app);
    let login_dirs: Vec<PathBuf> = std::env::split_paths(&login).collect();
    if let Some(p) = find_in_dirs(&login_dirs, &name) {
        return Some(p.to_string_lossy().into_owned());
    }
    which(&name).map(|p| p.to_string_lossy().into_owned())
}

fn valid_program_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAvailableProgram {
    name: String,
    launch_command: String,
}

#[cfg(unix)]
fn quote_terminal_command(path: &std::path::Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

#[cfg(unix)]
fn is_executable_file(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(unix)]
fn known_terminal_program(name: &str) -> Option<String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let candidates: Vec<PathBuf> = match name {
        "codex" => {
            let mut paths = vec![PathBuf::from(
                "/Applications/ChatGPT.app/Contents/Resources/codex",
            )];
            if let Some(home) = &home {
                paths.push(home.join("Applications/ChatGPT.app/Contents/Resources/codex"));
                paths.push(home.join(".local/bin/codex"));
            }
            paths
        }
        "claude" => home
            .map(|home| vec![home.join(".local/bin/claude")])
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    candidates
        .into_iter()
        .find(|path| is_executable_file(path))
        .map(|path| quote_terminal_command(&path))
}

/// Reports commands visible to the same login+interactive shell used by the PTY.
/// This intentionally differs from `resolve_program`: the PTY now spawns a
/// login shell, so the probe must match that startup (zprofile + zshrc).
#[tauri::command]
pub fn terminal_available_programs(names: Vec<String>) -> Vec<TerminalAvailableProgram> {
    let names: Vec<String> = names
        .into_iter()
        .filter(|name| valid_program_name(name))
        .collect();
    if names.is_empty() {
        return Vec::new();
    }

    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let probe = names
            .iter()
            .map(|name| {
                format!("command -v {name} >/dev/null 2>&1 && printf '__CODEZAL_CLI__{name}\\n'")
            })
            .collect::<Vec<_>>()
            .join("; ");
        // -ilc: login + interactive. The PTY now opens a login shell, so the
        // probe must see the same PATH (for example brew shellenv in ~/.zprofile).
        let stdout = std::process::Command::new(shell)
            .args(["-ilc", &probe])
            .output()
            .ok()
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default();
        return names
            .into_iter()
            .filter_map(|name| {
                let visible = stdout
                    .lines()
                    .any(|line| line == format!("__CODEZAL_CLI__{name}"));
                let launch_command = if visible {
                    Some(name.clone())
                } else {
                    known_terminal_program(&name)
                }?;
                Some(TerminalAvailableProgram {
                    name,
                    launch_command,
                })
            })
            .collect();
    }

    #[cfg(windows)]
    {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        return names
            .into_iter()
            .filter_map(|name| {
                let visible = std::process::Command::new(&shell)
                    .args(["/D", "/S", "/C", &format!("where {name} >NUL 2>NUL")])
                    .status()
                    .map(|status| status.success())
                    .unwrap_or(false);
                visible.then(|| TerminalAvailableProgram {
                    launch_command: name.clone(),
                    name,
                })
            })
            .collect();
    }
}

static LOGIN_PATH: OnceLock<String> = OnceLock::new();

#[tauri::command]
pub fn login_path(app: AppHandle) -> String {
    LOGIN_PATH
        .get_or_init(|| {
            // Temel PATH: unix login shell PATH, Windows process PATH (global).
            #[cfg(not(windows))]
            let base = {
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
                std::process::Command::new(&shell)
                    .args(["-lc", "printf %s \"$PATH\""])
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .filter(|p| !p.is_empty())
                    .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
            };
            #[cfg(windows)]
            let base = std::env::var("PATH").unwrap_or_default();

            let bundled = bundled_git_dirs(&app);
            if bundled.is_empty() {
                return base;
            }
            let sep = if cfg!(windows) { ";" } else { ":" };
            let prefix = bundled
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(sep);
            if base.is_empty() {
                prefix
            } else {
                format!("{prefix}{sep}{base}")
            }
        })
        .clone()
}

#[tauri::command]
pub fn process_alive(pid: u32) -> bool {
    #[cfg(not(windows))]
    {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}
