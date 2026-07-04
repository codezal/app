// Codezal Tauri entry — plugin registrations + invoke handlers.
mod browser;
mod code_map;
mod db;
mod editors;
mod exec;
mod fs;
mod inference;
mod mlx_native;
mod server;
// chat_render_check example can diff it against the oai-compat reference.
#[cfg(feature = "local-llm")]
pub mod chat_render;
// serde_json (no feature gate) so its unit tests run in a plain `cargo test`.
pub mod chat_parse;
mod lsp;
mod pty;
mod secrets;

#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

// Read an environment variable by name; returns None when unset/empty.
// Provider auth chain calls this to detect env fallbacks (ANTHROPIC_API_KEY, etc.).
#[tauri::command]
fn read_env_var(name: String) -> Option<String> {
    match std::env::var(&name) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

// Autopilot keep-awake: sistem idle-sleep'i engelle ki scheduler sahipsizken
#[derive(Default)]
struct KeepAwakeState(std::sync::Mutex<Option<std::process::Child>>);

#[cfg(target_os = "windows")]
const PS_KEEPAWAKE: &str = "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);'; while($true){ [W.P]::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds 50 }";

#[tauri::command]
fn set_keep_awake(enabled: bool, state: tauri::State<KeepAwakeState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if !enabled {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("caffeinate")
        .arg("-dimsu")
        .spawn();
    #[cfg(target_os = "windows")]
    let spawned = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                PS_KEEPAWAKE,
            ])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let spawned: std::io::Result<std::process::Child> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "keep-awake unsupported on this platform",
    ));
    match spawned {
        Ok(child) => {
            *guard = Some(child);
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .manage(pty::PtyManager::default())
        .manage(lsp::LspManager::default())
        .manage(browser::BrowserManager::default())
        .manage(KeepAwakeState::default())
        .manage(inference::LlmManager::default())
        .manage(server::ServerState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::proc_kill_tree,
            pty::pty_ensure_rcfiles,
            read_env_var,
            set_keep_awake,
            inference::llm_load,
            inference::llm_generate_stream,
            inference::llm_cancel,
            inference::llm_chat,
            inference::llm_list_models,
            inference::llm_download,
            inference::llm_cancel_download,
            inference::llm_delete_model,
            inference::llm_models_info,
            inference::hf_list_gguf,
            inference::hf_search_gguf,
            inference::llm_system_ram,
            mlx_native::mlx_chat,
            mlx_native::mlx_cancel,
            mlx_native::mlx_download,
            mlx_native::mlx_list_models,
            mlx_native::mlx_delete_model,
            server::inference_server_start,
            server::inference_server_stop,
            server::inference_server_status,
            code_map::codemap_build,
            code_map::codemap_reindex_file,
            code_map::codemap_reindex_files,
            code_map::codemap_search,
            code_map::codemap_callers,
            code_map::codemap_callees,
            code_map::codemap_node,
            code_map::codemap_file_symbols,
            code_map::codemap_impact,
            code_map::codemap_trace,
            code_map::codemap_context,
            code_map::codemap_status,
            editors::detect_editors,
            editors::open_in_editor,
            exec::os_platform,
            exec::resolve_program,
            exec::login_path,
            exec::process_alive,
            fs::fs_read_text_file,
            fs::fs_read_file_base64,
            fs::fs_write_text_file,
            fs::fs_write_file_base64,
            fs::fs_exists,
            fs::fs_read_dir,
            fs::fs_stat_size,
            fs::fs_copy_dir,
            fs::fs_remove_dir,
            lsp::lsp_start,
            lsp::lsp_stop,
            lsp::lsp_open_file,
            lsp::lsp_change_file,
            lsp::lsp_close_file,
            lsp::lsp_hover,
            lsp::lsp_definition,
            lsp::lsp_references,
            lsp::lsp_implementation,
            lsp::lsp_document_symbol,
            lsp::lsp_workspace_symbol,
            lsp::lsp_prepare_call_hierarchy,
            lsp::lsp_incoming_calls,
            lsp::lsp_outgoing_calls,
            lsp::lsp_get_diagnostics,
            lsp::lsp_code_action,
            lsp::lsp_resolve_code_action,
            lsp::lsp_execute_command,
            lsp::lsp_platform,
            lsp::lsp_server_installed,
            lsp::lsp_check_command,
            lsp::lsp_install_server,
            lsp::lsp_resource_dir,
            lsp::lsp_path_exists,
            db::db_execute,
            db::db_select,
            db::db_batch,
            db::db_select_external,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            browser::browser_navigate,
            browser::browser_screenshot,
            browser::browser_console,
            browser::browser_network,
            browser::browser_close,
            browser::browser_snapshot,
            browser::browser_click,
            browser::browser_fill,
            browser::browser_select,
            browser::browser_press,
            browser::browser_type,
            browser::browser_scroll,
            browser::browser_hover,
            browser::browser_wait,
            browser::browser_eval,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                lsp::shutdown_all(window.state::<lsp::LspManager>().inner());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Auto-updater — desktop only (mobile targets ship no updater plugin).
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec!["--autostart"]),
                ))?;
            }
            #[cfg(target_os = "windows")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
            }
            // macOS: pencereye opak NSWindow backgroundColor ver. Overlay (transparent)
            // titlebar'da bu olmadan inactive traffic light'lar hollow/beyaz render olur;
            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                use objc2_app_kit::{NSColor, NSWindow};
                if let Ok(ptr) = w.ns_window() {
                    let ns_window = unsafe { &*(ptr as *mut NSWindow) };
                    let bg = NSColor::colorWithRed_green_blue_alpha(
                        233.0 / 255.0,
                        231.0 / 255.0,
                        226.0 / 255.0,
                        1.0,
                    );
                    ns_window.setBackgroundColor(Some(&bg));
                }
            }
            // applySchema ile (idempotent) kurulur.
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).ok();
            let conn = db::open(data_dir.join("codezal.db"))?;
            app.manage(db::DbState(std::sync::Mutex::new(conn)));

            // item'lar menu:* event'i emit eder; frontend (App.tsx) dinleyip aksiyonu
            // tetikler. Edit submenu predefined (undo/redo/cut/copy/paste/selectAll) —
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

                let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;
                let app_menu = SubmenuBuilder::new(app, "Codezal")
                    .about(None)
                    .separator()
                    .item(&settings_item)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let new_chat = MenuItemBuilder::with_id("menu:new-chat", "New Chat")
                    .accelerator("CmdOrCtrl+N")
                    .build(app)?;
                let new_project = MenuItemBuilder::with_id("menu:new-project", "New Project")
                    .accelerator("CmdOrCtrl+Shift+N")
                    .build(app)?;
                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&new_chat)
                    .item(&new_project)
                    .separator()
                    .close_window()
                    .build()?;

                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let split_item = MenuItemBuilder::with_id("menu:toggle-split", "Split View")
                    .accelerator("CmdOrCtrl+\\")
                    .build(app)?;
                let view_menu = SubmenuBuilder::new(app, "View")
                    .item(&split_item)
                    .separator()
                    .fullscreen()
                    .build()?;

                let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
                    .build()?;
                app.set_menu(menu)?;
                app.on_menu_event(move |handle, event| {
                    let id = event.id().0.as_str();
                    if id.starts_with("menu:") {
                        let _ = handle.emit(id, ());
                    }
                });
            }

            // flush+destroy sinyali.
            #[cfg(desktop)]
            {
                use tauri::image::Image;
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::TrayIconBuilder;

                #[cfg(target_os = "macos")]
                let tray_icon =
                    Image::from_bytes(include_bytes!("../../public/codezal-glyph-1024.png"));
                #[cfg(not(target_os = "macos"))]
                let tray_icon =
                    Image::from_bytes(include_bytes!("../../public/codezal-glyph-white-1024.png"));
                if let Ok(icon) = tray_icon {
                    let show_item =
                        MenuItemBuilder::with_id("tray:show", "Show Codezal").build(app)?;
                    let quit_item =
                        MenuItemBuilder::with_id("tray:quit", "Quit Codezal").build(app)?;
                    let tray_menu = MenuBuilder::new(app)
                        .items(&[&show_item, &quit_item])
                        .build()?;
                    let _tray = TrayIconBuilder::with_id("codezal-tray")
                        .tooltip("Codezal")
                        .icon(icon)
                        .icon_as_template(true)
                        .menu(&tray_menu)
                        .show_menu_on_left_click(true)
                        .on_menu_event(|app, event| match event.id().0.as_str() {
                            "tray:show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                            "tray:quit" => {
                                let _ = app.emit("codezal:tray-quit", ());
                            }
                            _ => {}
                        })
                        .build(app)?;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
