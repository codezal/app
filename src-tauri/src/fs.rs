//

use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// User-approved workspace roots (canonicalized). Paths under any of these are
/// allowed in addition to the user's home directory. This is what makes
/// workspaces living OUTSIDE the home dir work — very common on Windows where
/// projects sit on other drives (D:\, E:\, network shares). Populated at
/// runtime via `register_workspace_root` and persisted by tauri-plugin-fs's
/// scope (tauri-plugin-persisted-scope keeps the grants across restarts).
#[derive(Default)]
pub struct WorkspaceRoots(pub Mutex<Vec<PathBuf>>);

fn load_roots(state: &tauri::State<WorkspaceRoots>) -> Result<Vec<PathBuf>, String> {
    state.0.lock().map(|g| g.clone()).map_err(|e| e.to_string())
}

/// Read-only escape hatch: the OS temp dir is readable through the fs bridge
/// so read-only tooling (e.g. skill bundles staged under /tmp by review
/// pipelines) can be inspected. Writes stay workspace/home-only — and the
/// bash tool already runs unsandboxed as the same user, so allowing temp-dir
/// READS here does not widen real read capability.
fn temp_read_roots() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![std::env::temp_dir()];
    #[cfg(unix)]
    {
        // macOS: std::env::temp_dir() is $TMPDIR (/var/folders/...), but tools
        // also stage under the classic /tmp (a symlink to /private/tmp) — cover
        // both spellings plus their canonical forms.
        candidates.push(PathBuf::from("/tmp"));
        candidates.push(PathBuf::from("/private/tmp"));
    }
    candidates
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.canonicalize().unwrap_or(p))
        .collect()
}

fn ensure_read_allowed(path: &str, roots: &[PathBuf]) -> Result<(), String> {
    match ensure_allowed(path, roots) {
        Ok(()) => Ok(()),
        Err(e) => {
            let canon = Path::new(path)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(path));
            if temp_read_roots().iter().any(|r| canon.starts_with(r)) {
                return Ok(());
            }
            Err(e)
        }
    }
}

fn ensure_allowed(path: &str, roots: &[PathBuf]) -> Result<(), String> {
    // Windows USERPROFILE, POSIX HOME — Tauri'nin $HOME scope'uyla (dirs::home_dir)
    // Home is OPTIONAL now: a registered workspace root can authorize a path on
    // its own (e.g. a D:\ project when HOME is C:\Users\...).
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home_canon = std::env::var(home_var)
        .ok()
        .and_then(|h| Path::new(&h).canonicalize().ok());

    let under_allowed = |canon: &Path| -> bool {
        if let Some(ref home) = home_canon {
            if canon.starts_with(home) {
                // M89: the home-wide allowlist must NOT expose dot-directories
                // (~/.ssh, ~/.config, …) — they hold secrets. The app's own
                // ~/.codezal is the one exception (plugin/DB/memory writes).
                if let Ok(rel) = canon.strip_prefix(home) {
                    let first = rel.components().next();
                    if let Some(std::path::Component::Normal(seg)) = first {
                        if seg.to_string_lossy().starts_with('.') && seg != ".codezal" {
                            return false;
                        }
                    }
                }
                return true;
            }
        }
        roots.iter().any(|r| canon.starts_with(r))
    };

    let mut probe: Option<PathBuf> = Some(PathBuf::from(path));
    while let Some(p) = probe {
        match p.canonicalize() {
            Ok(canon) => {
                if under_allowed(&canon) {
                    return Ok(());
                }
                return Err(format!("forbidden path: {}", path));
            }
            Err(_) => probe = p.parent().map(|x| x.to_path_buf()),
        }
    }
    Err(format!("forbidden path: {}", path))
}

/// Register a workspace root the user explicitly opened. Allows the whole tree
/// in BOTH layers: the tauri-plugin-fs runtime scope (primary JS plugin path,
/// persisted across restarts) and the Rust fallback allowlist used by the
/// `fs_*` commands below. Idempotent.
#[tauri::command]
pub fn register_workspace_root(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Ok(());
    }
    let raw = PathBuf::from(trimmed);
    // canonicalize resolves symlinks + normalizes separators; fall back to the
    // raw path when the dir does not exist yet (e.g. a clone target).
    let canon = raw.canonicalize().unwrap_or_else(|_| raw.clone());
    // Primary plugin-fs path: allow the whole workspace subtree recursively.
    // On Windows canonicalize() yields a \\?\ UNC path while JS request paths
    // arrive in plain drive-letter form (D:\...); the scope matches on the path
    // string, so register BOTH forms to be safe whichever way the plugin
    // normalises a request. Errors are non-fatal — the Rust allowlist below
    // still covers the fallback commands.
    let _ = app.fs_scope().allow_directory(&raw, true);
    if canon != raw {
        let _ = app.fs_scope().allow_directory(&canon, true);
    }
    let mut roots = state.0.lock().map_err(|e| e.to_string())?;
    if !roots.iter().any(|r| r == &canon) {
        roots.push(canon);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_read_text_file(
    path: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<String, String> {
    let roots = load_roots(&state)?;
    ensure_read_allowed(&path, &roots)?;
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_read_file_base64(
    path: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<String, String> {
    let roots = load_roots(&state)?;
    ensure_read_allowed(&path, &roots)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn fs_write_text_file(
    path: String,
    contents: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<(), String> {
    let roots = load_roots(&state)?;
    ensure_allowed(&path, &roots)?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", path, e))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_write_file_base64(
    path: String,
    contents: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<(), String> {
    let roots = load_roots(&state)?;
    ensure_allowed(&path, &roots)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| format!("{}: base64 decode: {}", path, e))?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", path, e))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {}", path, e))
}

/// Rename/move used by the atomic-write path (temp file → target). Both ends
/// must be write-allowed. std::fs::rename replaces an existing destination on
/// both Unix and Windows (MoveFileEx + MOVEFILE_REPLACE_EXISTING).
#[tauri::command]
pub fn fs_rename(
    from: String,
    to: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<(), String> {
    let roots = load_roots(&state)?;
    ensure_allowed(&from, &roots)?;
    ensure_allowed(&to, &roots)?;
    std::fs::rename(&from, &to).map_err(|e| format!("{} -> {}: {}", from, to, e))
}

#[tauri::command]
pub fn fs_exists(path: String, state: tauri::State<WorkspaceRoots>) -> Result<bool, String> {
    let roots = load_roots(&state)?;
    ensure_read_allowed(&path, &roots)?;
    Ok(Path::new(&path).exists())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    is_directory: bool,
}

#[tauri::command]
pub fn fs_read_dir(
    path: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<Vec<FsEntry>, String> {
    let roots = load_roots(&state)?;
    ensure_read_allowed(&path, &roots)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("{}: {}", path, e))? {
        let entry = entry.map_err(|e| format!("{}: {}", path, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_directory = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(FsEntry { name, is_directory });
    }
    Ok(out)
}

#[tauri::command]
pub fn fs_stat_size(path: String, state: tauri::State<WorkspaceRoots>) -> Result<u64, String> {
    let roots = load_roots(&state)?;
    ensure_read_allowed(&path, &roots)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok(meta.len())
}

#[tauri::command]
pub fn fs_copy_dir(
    src: String,
    dest: String,
    state: tauri::State<WorkspaceRoots>,
) -> Result<(), String> {
    let roots = load_roots(&state)?;
    // M87: the source was never validated — a manifest-supplied src (e.g.
    // `~/.ssh`) could be copied out via the plugin installer. Read-allow (not
    // full allow) so the temp-dir escape hatch still works for staging dirs.
    ensure_read_allowed(&src, &roots)?;
    ensure_allowed(&dest, &roots)?;
    copy_dir_contents(Path::new(&src), Path::new(&dest)).map_err(|e| format!("copy_dir: {}", e))
}

fn copy_dir_contents(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        } else if ft.is_dir() {
            copy_dir_contents(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn ensure_under_codezal(path: &str) -> Result<(), String> {
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_var).map_err(|_| format!("{} env yok", home_var))?;
    let home_canon = Path::new(&home)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&home));
    let root = match Path::new(&home).join(".codezal").canonicalize() {
        Ok(r) => r,
        Err(_) => {
            return match Path::new(path).canonicalize() {
                Ok(_) => Err(format!("forbidden path: {}", path)),
                Err(_) => Ok(()),
            };
        }
    };
    // M88: `$HOME/.codezal` itself could be a symlink pointing outside home
    // (worst case: to `/`). The canonicalized root MUST stay inside the
    // canonicalized home, or `fs_remove_dir`'s containment check would pass for
    // literally any path on the machine.
    if root != home_canon && !root.starts_with(&home_canon) {
        return Err(format!("forbidden root: {}", root.to_string_lossy()));
    }

    let mut probe: Option<PathBuf> = Some(PathBuf::from(path));
    while let Some(p) = probe {
        match p.canonicalize() {
            Ok(canon) => {
                if canon != root && canon.starts_with(&root) {
                    return Ok(());
                }
                return Err(format!("forbidden path: {}", path));
            }
            Err(_) => probe = p.parent().map(|x| x.to_path_buf()),
        }
    }
    Err(format!("forbidden path: {}", path))
}

/// Resolve all symlinks and return the canonical (real) path. Used by the
/// frontend to verify that a path inside the workspace does not escape it via
/// a symlink. Returns an error when the path does not
/// exist or cannot be canonicalized.
#[tauri::command]
pub fn fs_realpath(path: String) -> Result<String, String> {
    Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("{}: {}", path, e))
}

/// Read a symlink's raw target (std::fs::read_link — NO canonicalization).
/// Used by the clipboard layer to RE-CREATE a symlink during cut/paste (M74).
/// Errors when the path is not a symlink or is unreadable.
#[tauri::command]
pub fn fs_read_link(path: String) -> Result<String, String> {
    std::fs::read_link(&path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_remove_dir(path: String) -> Result<(), String> {
    ensure_under_codezal(&path)?;
    let p = Path::new(&path);
    let meta = match std::fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(_) => return Ok(()), // yok → no-op
    };
    let r = if meta.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };
    r.map_err(|e| format!("{}: {}", path, e))
}
