// External editor integration — detect installed editors and open files in
// them, optionally jumping to a line. Cross-platform: resolves the editor CLI
// launcher via PATH first, then well-known per-OS install locations (covers the
// macOS GUI-launch case where the app inherits a minimal PATH without the CLI
// shims). All VS Code forks share the `-g <file>:<line>` goto flag.
use std::path::PathBuf;

// One supported editor. `id` is the stable key shared with the frontend;
// `cmd` is the CLI launcher name as it appears on PATH.
struct Editor {
    id: &'static str,
    cmd: &'static str,
}

const EDITORS: &[Editor] = &[
    Editor {
        id: "vscode",
        cmd: "code",
    },
    Editor {
        id: "vscode-insiders",
        cmd: "code-insiders",
    },
    Editor {
        id: "cursor",
        cmd: "cursor",
    },
    Editor {
        id: "windsurf",
        cmd: "windsurf",
    },
    Editor {
        id: "vscodium",
        cmd: "codium",
    },
];

// Home directory, used to build per-user install fallbacks.
#[allow(dead_code)]
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

// `which`-style PATH lookup. On Windows it also tries each PATHEXT suffix so a
// `.cmd`/`.exe` launcher resolves from a bare command name.
fn which(cmd: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    #[cfg(windows)]
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(|s| s.to_string())
        .collect();
    #[cfg(not(windows))]
    let exts: Vec<String> = vec![String::new()];

    for dir in std::env::split_paths(&paths) {
        for ext in &exts {
            let candidate = dir.join(format!("{cmd}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// Well-known absolute install locations for the editor CLI launcher, per OS.
// These cover launches where PATH is minimal (notably macOS apps started from
// Finder, which don't inherit the user's shell PATH).
fn fallback_candidates(cmd: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let app = match cmd {
            "code" => Some(("Visual Studio Code", "code")),
            "code-insiders" => Some(("Visual Studio Code - Insiders", "code-insiders")),
            "cursor" => Some(("Cursor", "cursor")),
            "windsurf" => Some(("Windsurf", "windsurf")),
            "codium" => Some(("VSCodium", "codium")),
            _ => None,
        };
        if let Some((app_name, bin)) = app {
            let rel = format!("Contents/Resources/app/bin/{bin}");
            out.push(PathBuf::from(format!("/Applications/{app_name}.app/{rel}")));
            if let Some(h) = home() {
                out.push(h.join(format!("Applications/{app_name}.app/{rel}")));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Launcher lives at <install>\bin\<cmd>.cmd. VS Code-family installers
        // drop into LOCALAPPDATA\Programs (user) or Program Files (system).
        let (folder, bin) = match cmd {
            "code" => ("Microsoft VS Code", "code.cmd"),
            "code-insiders" => ("Microsoft VS Code Insiders", "code-insiders.cmd"),
            "cursor" => ("cursor", "cursor.cmd"),
            "windsurf" => ("Windsurf", "windsurf.cmd"),
            "codium" => ("VSCodium", "codium.cmd"),
            _ => ("", ""),
        };
        if !folder.is_empty() {
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                out.push(PathBuf::from(format!(
                    "{local}\\Programs\\{folder}\\bin\\{bin}"
                )));
            }
            for base in ["ProgramFiles", "ProgramFiles(x86)"] {
                if let Ok(b) = std::env::var(base) {
                    out.push(PathBuf::from(format!("{b}\\{folder}\\bin\\{bin}")));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for dir in [
            "/usr/bin",
            "/usr/local/bin",
            "/snap/bin",
            "/var/lib/flatpak/exports/bin",
        ] {
            out.push(PathBuf::from(dir).join(cmd));
        }
    }

    out
}

// Absolute path to an editor launcher, or None if not installed.
fn resolve(cmd: &str) -> Option<PathBuf> {
    if let Some(p) = which(cmd) {
        return Some(p);
    }
    fallback_candidates(cmd).into_iter().find(|p| p.is_file())
}

// Return the ids of editors found installed on this machine.
#[tauri::command]
pub fn detect_editors() -> Vec<String> {
    EDITORS
        .iter()
        .filter(|e| resolve(e.cmd).is_some())
        .map(|e| e.id.to_string())
        .collect()
}

// Open `path` in the editor with the given id, jumping to `line` when provided.
#[tauri::command]
pub fn open_in_editor(cmd: String, path: String, line: Option<u32>) -> Result<(), String> {
    let editor = EDITORS
        .iter()
        .find(|e| e.id == cmd)
        .ok_or_else(|| format!("unknown editor: {cmd}"))?;
    let bin = resolve(editor.cmd).ok_or_else(|| format!("editor not found: {cmd}"))?;

    // `-g <file>:<line>` jumps to a line; with just the path it opens the file.
    let target = match line {
        Some(l) if l > 0 => format!("{path}:{l}"),
        _ => path,
    };

    let mut command = std::process::Command::new(&bin);
    command.arg("-g").arg(&target);

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
