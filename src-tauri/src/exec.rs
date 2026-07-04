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
    which(&name).map(|p| p.to_string_lossy().into_owned())
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
