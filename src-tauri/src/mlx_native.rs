use tauri::AppHandle;

#[cfg(all(target_os = "macos", feature = "llm-mlx"))]
mod imp {
    use std::{
        collections::VecDeque,
        fs,
        io::{BufRead, BufReader, Write},
        path::PathBuf,
        process::{Child, ChildStdin, Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc::{self, RecvTimeoutError},
            Arc, Mutex, OnceLock,
        },
        thread,
        time::Duration,
    };

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Emitter, Manager};

    static MLX_CANCEL: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
        OnceLock::new();
    static MLX_HELPER: OnceLock<Mutex<Option<PersistentHelper>>> = OnceLock::new();

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MlxChatArgs {
        gen_id: String,
        request: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MlxCancelArgs {
        gen_id: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MlxDownloadArgs {
        id: String,
        model: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MlxDeleteArgs {
        model: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MlxModelInfo {
        id: String,
        size: u64,
    }

    enum HelperMessage {
        Stdout(String),
        Stderr(String),
    }

    struct PersistentHelper {
        child: Child,
        stdin: ChildStdin,
        rx: mpsc::Receiver<HelperMessage>,
        stderr_tail: VecDeque<String>,
    }

    pub async fn mlx_chat_impl(app: AppHandle, args: MlxChatArgs) -> Result<(), String> {
        let gen_id = args.gen_id.clone();
        let request = args.request.clone();
        let cancel = set_cancel(&gen_id)?;
        tauri::async_runtime::spawn_blocking(move || run_mlx_chat(app, gen_id, request, cancel));
        Ok(())
    }

    pub async fn mlx_download_impl(app: AppHandle, args: MlxDownloadArgs) -> Result<(), String> {
        let id = args.id.clone();
        let model = args.model.clone();
        let cancel = set_cancel(&id)?;
        tauri::async_runtime::spawn_blocking(move || run_mlx_download(app, id, model, cancel));
        Ok(())
    }

    pub fn mlx_cancel_impl(args: MlxCancelArgs) -> Result<(), String> {
        let map = cancel_map().lock().map_err(|e| e.to_string())?;
        if let Some(gen_id) = args.gen_id {
            if let Some(flag) = map.get(&gen_id) {
                flag.store(true, Ordering::Relaxed);
            }
        } else {
            for flag in map.values() {
                flag.store(true, Ordering::Relaxed);
            }
        }
        Ok(())
    }

    fn run_mlx_chat(app: AppHandle, gen_id: String, request: String, cancel: Arc<AtomicBool>) {
        let event = format!("mlx:chat:{gen_id}");
        let result = run_mlx_chat_inner(app.clone(), event.clone(), request, cancel);
        if let Err(message) = result {
            emit_error(&app, &event, message);
        }
        clear_cancel(&gen_id);
    }

    fn run_mlx_chat_inner(
        app: AppHandle,
        event: String,
        request: String,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        run_persistent_mlx_chat(&app, &event, &request, cancel)
    }

    fn run_mlx_download(app: AppHandle, id: String, model: String, cancel: Arc<AtomicBool>) {
        let event = format!("mlx:download:{id}");
        let result = run_mlx_download_inner(app.clone(), event.clone(), model.clone(), cancel);
        clear_cancel(&id);
        match result {
            Ok(()) => {
                if let Err(e) = mark_mlx_model(&model) {
                    emit_error(&app, &event, e);
                    return;
                }
                let _ = app.emit(&event, serde_json::json!({ "kind": "done" }));
            }
            Err(message) => emit_error(&app, &event, message),
        }
    }

    fn run_mlx_download_inner(
        app: AppHandle,
        event: String,
        model: String,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        run_mlx_helper(&app, &event, "download", &model, cancel)
    }

    fn run_persistent_mlx_chat(
        app: &AppHandle,
        event: &str,
        request: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let mut slot = persistent_helper_slot()
            .lock()
            .map_err(|e| format!("lock MLX helper: {e}"))?;

        let write_result = {
            let helper = ensure_persistent_helper(app, &mut slot)?;
            let mut line =
                serde_json::json!({ "id": event, "command": "chat", "input": request }).to_string();
            line.push('\n');
            helper
                .stdin
                .write_all(line.as_bytes())
                .and_then(|_| helper.stdin.flush())
        };

        if let Err(e) = write_result {
            stop_persistent_helper(&mut slot);
            return Err(format!("write MLX helper stdin: {e}"));
        }

        loop {
            if cancel.load(Ordering::Relaxed) {
                stop_persistent_helper(&mut slot);
                let _ = app.emit(event, serde_json::json!({ "kind": "done" }));
                return Ok(());
            }

            let message = match slot.as_mut() {
                Some(helper) => helper.rx.recv_timeout(Duration::from_millis(100)),
                None => return Err("MLX helper stopped".to_string()),
            };

            match message {
                Ok(HelperMessage::Stdout(line)) => {
                    let done = match slot.as_mut() {
                        Some(helper) => {
                            emit_persistent_helper_line(app, event, &line, &mut helper.stderr_tail)?
                        }
                        None => false,
                    };
                    if done {
                        return Ok(());
                    }
                }
                Ok(HelperMessage::Stderr(line)) => {
                    if let Some(helper) = slot.as_mut() {
                        push_stderr_tail(&mut helper.stderr_tail, line);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    thread::sleep(Duration::from_millis(50));
                }
            }

            let status = match slot.as_mut() {
                Some(helper) => helper
                    .child
                    .try_wait()
                    .map_err(|e| format!("poll MLX helper: {e}"))?,
                None => return Err("MLX helper stopped".to_string()),
            };

            if let Some(status) = status {
                if let Some(helper) = slot.as_mut() {
                    drain_persistent_helper_messages(app, event, helper);
                }
                let stderr = slot
                    .as_ref()
                    .map(|helper| {
                        helper
                            .stderr_tail
                            .iter()
                            .cloned()
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                *slot = None;
                return Err(if stderr.is_empty() {
                    format!("MLX helper exited with {status}")
                } else {
                    format!("MLX helper exited with {status}: {stderr}")
                });
            }
        }
    }

    fn ensure_persistent_helper<'a>(
        app: &AppHandle,
        slot: &'a mut Option<PersistentHelper>,
    ) -> Result<&'a mut PersistentHelper, String> {
        let exited = match slot.as_mut() {
            Some(helper) => helper
                .child
                .try_wait()
                .map_err(|e| format!("poll MLX helper: {e}"))?
                .is_some(),
            None => false,
        };

        if exited {
            *slot = None;
        }

        if slot.is_none() {
            *slot = Some(start_persistent_helper(app)?);
        }

        slot.as_mut()
            .ok_or_else(|| "MLX helper unavailable".to_string())
    }

    fn start_persistent_helper(app: &AppHandle) -> Result<PersistentHelper, String> {
        let helper = resolve_helper_path(app)?;
        let mut child = Command::new(helper)
            .arg("serve")
            .env("CODEZAL_MLX_PARENT_PID", std::process::id().to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("start MLX helper: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MLX helper stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MLX helper stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "MLX helper stderr unavailable".to_string())?;
        let (tx, rx) = mpsc::channel::<HelperMessage>();
        spawn_pipe_reader(stdout, tx.clone(), false);
        spawn_pipe_reader(stderr, tx, true);

        Ok(PersistentHelper {
            child,
            stdin,
            rx,
            stderr_tail: VecDeque::new(),
        })
    }

    fn stop_persistent_helper(slot: &mut Option<PersistentHelper>) {
        if let Some(mut helper) = slot.take() {
            let _ = helper.child.kill();
            let _ = helper.child.wait();
        }
    }

    fn run_mlx_helper(
        app: &AppHandle,
        event: &str,
        mode: &str,
        input: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let helper = resolve_helper_path(app)?;
        let mut child = Command::new(helper)
            .arg(mode)
            .env("CODEZAL_MLX_PARENT_PID", std::process::id().to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("start MLX helper: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .map_err(|e| format!("write MLX helper stdin: {e}"))?;
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MLX helper stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "MLX helper stderr unavailable".to_string())?;
        let (tx, rx) = mpsc::channel::<HelperMessage>();
        spawn_pipe_reader(stdout, tx.clone(), false);
        spawn_pipe_reader(stderr, tx, true);

        let mut stderr_tail = VecDeque::new();
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = app.emit(event, serde_json::json!({ "kind": "done" }));
                return Ok(());
            }

            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(HelperMessage::Stdout(line)) => {
                    if let Err(line) = emit_helper_line(app, event, &line) {
                        push_stderr_tail(&mut stderr_tail, line);
                    }
                }
                Ok(HelperMessage::Stderr(line)) => {
                    push_stderr_tail(&mut stderr_tail, line);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {}
            }

            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("poll MLX helper: {e}"))?
            {
                drain_helper_messages(app, event, &rx, &mut stderr_tail);
                if status.success() {
                    return Ok(());
                }
                let stderr = stderr_tail.into_iter().collect::<Vec<_>>().join("\n");
                return Err(if stderr.is_empty() {
                    format!("MLX helper exited with {status}")
                } else {
                    format!("MLX helper exited with {status}: {stderr}")
                });
            }
        }
    }

    fn spawn_pipe_reader<R>(reader: R, tx: mpsc::Sender<HelperMessage>, stderr: bool)
    where
        R: std::io::Read + Send + 'static,
    {
        thread::spawn(move || {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                let msg = if stderr {
                    HelperMessage::Stderr(line)
                } else {
                    HelperMessage::Stdout(line)
                };
                if tx.send(msg).is_err() {
                    break;
                }
            }
        });
    }

    fn drain_helper_messages(
        app: &AppHandle,
        event: &str,
        rx: &mpsc::Receiver<HelperMessage>,
        stderr_tail: &mut VecDeque<String>,
    ) {
        while let Ok(msg) = rx.try_recv() {
            match msg {
                HelperMessage::Stdout(line) => {
                    if let Err(line) = emit_helper_line(app, event, &line) {
                        push_stderr_tail(stderr_tail, line);
                    }
                }
                HelperMessage::Stderr(line) => {
                    push_stderr_tail(stderr_tail, line);
                }
            }
        }
    }

    fn drain_persistent_helper_messages(
        app: &AppHandle,
        event: &str,
        helper: &mut PersistentHelper,
    ) {
        while let Ok(msg) = helper.rx.try_recv() {
            match msg {
                HelperMessage::Stdout(line) => {
                    let _ = emit_persistent_helper_line(app, event, &line, &mut helper.stderr_tail);
                }
                HelperMessage::Stderr(line) => {
                    push_stderr_tail(&mut helper.stderr_tail, line);
                }
            }
        }
    }

    fn emit_helper_line(app: &AppHandle, event: &str, line: &str) -> Result<(), String> {
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return Err(line.to_string()),
        };
        let _ = app.emit(event, parsed);
        Ok(())
    }

    fn emit_persistent_helper_line(
        app: &AppHandle,
        event: &str,
        line: &str,
        stderr_tail: &mut VecDeque<String>,
    ) -> Result<bool, String> {
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                push_stderr_tail(stderr_tail, line.to_string());
                return Ok(false);
            }
        };

        let Some(id) = parsed.get("id").and_then(|value| value.as_str()) else {
            push_stderr_tail(stderr_tail, line.to_string());
            return Ok(false);
        };
        if id != event {
            return Ok(false);
        }

        let event_value = parsed
            .get("event")
            .cloned()
            .ok_or_else(|| format!("invalid MLX helper event: {line}"))?;
        let done = is_terminal_event(&event_value);
        let _ = app.emit(event, event_value);
        Ok(done)
    }

    fn is_terminal_event(value: &serde_json::Value) -> bool {
        matches!(
            value.get("kind").and_then(|kind| kind.as_str()),
            Some("done" | "error")
        )
    }

    fn push_stderr_tail(stderr_tail: &mut VecDeque<String>, line: String) {
        if stderr_tail.len() >= 8 {
            stderr_tail.pop_front();
        }
        stderr_tail.push_back(line);
    }

    fn resolve_helper_path(app: &AppHandle) -> Result<PathBuf, String> {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("mlx").join("CodezalMLXHelper");
            if bundled.exists() {
                return Ok(bundled);
            }
        }

        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("mlx")
            .join("CodezalMLXHelper");
        if dev.exists() {
            return Ok(dev);
        }

        Err("MLX helper not found; build with --features llm-mlx first".to_string())
    }

    fn emit_error(app: &AppHandle, event: &str, message: String) {
        let _ = app.emit(
            event,
            serde_json::json!({ "kind": "error", "message": message }),
        );
    }

    fn cancel_map() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
        MLX_CANCEL.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
    }

    fn persistent_helper_slot() -> &'static Mutex<Option<PersistentHelper>> {
        MLX_HELPER.get_or_init(|| Mutex::new(None))
    }

    fn set_cancel(gen_id: &str) -> Result<Arc<AtomicBool>, String> {
        let flag = Arc::new(AtomicBool::new(false));
        cancel_map()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(gen_id.to_string(), flag.clone());
        Ok(flag)
    }

    fn clear_cancel(gen_id: &str) {
        if let Ok(mut map) = cancel_map().lock() {
            map.remove(gen_id);
        }
    }

    pub fn list_mlx_models_impl() -> Result<Vec<MlxModelInfo>, String> {
        let dir = mlx_models_dir();
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let Ok(text) = fs::read_to_string(&path) else {
                    continue;
                };
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                    out.push(MlxModelInfo {
                        id: id.to_string(),
                        size: 0,
                    });
                }
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    pub fn delete_mlx_model_impl(args: MlxDeleteArgs) -> Result<(), String> {
        let path = mlx_models_dir().join(marker_name(&args.model));
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("delete MLX marker: {e}")),
        }
    }

    fn mark_mlx_model(model: &str) -> Result<(), String> {
        let dir = mlx_models_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("mkdir MLX marker dir: {e}"))?;
        let path = dir.join(marker_name(model));
        fs::write(path, serde_json::json!({ "id": model }).to_string())
            .map_err(|e| format!("write MLX marker: {e}"))
    }

    fn mlx_models_dir() -> PathBuf {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = std::env::var(home_var).unwrap_or_default();
        PathBuf::from(home)
            .join(".cache")
            .join("codezal")
            .join("mlx-models")
    }

    fn marker_name(model: &str) -> String {
        let mut out = String::new();
        for ch in model.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        out.push_str(".json");
        out
    }
}

#[tauri::command]
pub async fn mlx_chat(app: AppHandle, args: serde_json::Value) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "llm-mlx"))]
    {
        let args = serde_json::from_value(args).map_err(|e| e.to_string())?;
        imp::mlx_chat_impl(app, args).await
    }

    #[cfg(not(all(target_os = "macos", feature = "llm-mlx")))]
    {
        let _ = app;
        let _ = args;
        Err("MLX is available only on macOS builds with the llm-mlx feature".to_string())
    }
}

#[tauri::command]
pub async fn mlx_cancel(args: serde_json::Value) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "llm-mlx"))]
    {
        let args = serde_json::from_value(args).map_err(|e| e.to_string())?;
        imp::mlx_cancel_impl(args)
    }

    #[cfg(not(all(target_os = "macos", feature = "llm-mlx")))]
    {
        let _ = args;
        Ok(())
    }
}

#[tauri::command]
pub async fn mlx_download(app: AppHandle, args: serde_json::Value) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "llm-mlx"))]
    {
        let args = serde_json::from_value(args).map_err(|e| e.to_string())?;
        imp::mlx_download_impl(app, args).await
    }

    #[cfg(not(all(target_os = "macos", feature = "llm-mlx")))]
    {
        let _ = app;
        let _ = args;
        Err("MLX downloads are available only on macOS builds with the llm-mlx feature".to_string())
    }
}

#[tauri::command]
pub fn mlx_list_models() -> Result<serde_json::Value, String> {
    #[cfg(all(target_os = "macos", feature = "llm-mlx"))]
    {
        let list = imp::list_mlx_models_impl()?;
        serde_json::to_value(list).map_err(|e| e.to_string())
    }

    #[cfg(not(all(target_os = "macos", feature = "llm-mlx")))]
    {
        Ok(serde_json::Value::Array(Vec::new()))
    }
}

#[tauri::command]
pub fn mlx_delete_model(args: serde_json::Value) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "llm-mlx"))]
    {
        let args = serde_json::from_value(args).map_err(|e| e.to_string())?;
        imp::delete_mlx_model_impl(args)
    }

    #[cfg(not(all(target_os = "macos", feature = "llm-mlx")))]
    {
        let _ = args;
        Ok(())
    }
}
