// Codezal Tauri entry — plugin registrations + invoke handlers.
mod pty;

// Read an environment variable by name; returns None when unset/empty.
// Provider auth chain calls this to detect env fallbacks (ANTHROPIC_API_KEY, etc.).
#[tauri::command]
fn read_env_var(name: String) -> Option<String> {
    match std::env::var(&name) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(pty::PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            read_env_var,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
