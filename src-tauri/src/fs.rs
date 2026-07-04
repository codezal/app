//

use base64::Engine as _;
use std::path::{Path, PathBuf};

fn ensure_under_home(path: &str) -> Result<(), String> {
    // Windows USERPROFILE, POSIX HOME — Tauri'nin $HOME scope'uyla (dirs::home_dir)
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_var).map_err(|_| format!("{} env yok", home_var))?;
    let home_canon = Path::new(&home)
        .canonicalize()
        .map_err(|e| format!("HOME canonicalize: {}", e))?;

    let mut probe: Option<PathBuf> = Some(PathBuf::from(path));
    while let Some(p) = probe {
        match p.canonicalize() {
            Ok(canon) => {
                if canon.starts_with(&home_canon) {
                    return Ok(());
                }
                return Err(format!("forbidden path: {}", path));
            }
            Err(_) => probe = p.parent().map(|x| x.to_path_buf()),
        }
    }
    Err(format!("forbidden path: {}", path))
}

#[tauri::command]
pub fn fs_read_text_file(path: String) -> Result<String, String> {
    ensure_under_home(&path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_read_file_base64(path: String) -> Result<String, String> {
    ensure_under_home(&path)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    ensure_under_home(&path)?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", path, e))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_write_file_base64(path: String, contents: String) -> Result<(), String> {
    ensure_under_home(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| format!("{}: base64 decode: {}", path, e))?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", path, e))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub fn fs_exists(path: String) -> Result<bool, String> {
    ensure_under_home(&path)?;
    Ok(Path::new(&path).exists())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    is_directory: bool,
}

#[tauri::command]
pub fn fs_read_dir(path: String) -> Result<Vec<FsEntry>, String> {
    ensure_under_home(&path)?;
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
pub fn fs_stat_size(path: String) -> Result<u64, String> {
    ensure_under_home(&path)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok(meta.len())
}

#[tauri::command]
pub fn fs_copy_dir(src: String, dest: String) -> Result<(), String> {
    ensure_under_home(&dest)?;
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
    let root = match Path::new(&home).join(".codezal").canonicalize() {
        Ok(r) => r,
        Err(_) => {
            return match Path::new(path).canonicalize() {
                Ok(_) => Err(format!("forbidden path: {}", path)),
                Err(_) => Ok(()),
            };
        }
    };

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
