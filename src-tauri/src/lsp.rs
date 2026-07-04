//
//   const id = await invoke('lsp_start', { id, workspaceRoot, serverCmd, serverArgs })
//   await invoke('lsp_open_file', { id, filePath, content })
//   await invoke('lsp_change_file', { id, filePath, content })
//   await invoke('lsp_close_file', { id, filePath })
//   const result = await invoke('lsp_hover', { id, filePath, line, character })
//   const result = await invoke('lsp_definition', { id, filePath, line, character })
//   const result = await invoke('lsp_references', { id, filePath, line, character })
//   const diags  = await invoke('lsp_get_diagnostics', { id, filePath })
//   await invoke('lsp_stop', { id })
//
//   listen(`lsp:diagnostics:${id}`, ev => /* { uri: string, diagnostics: Diagnostic[] } */)

use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

// ─── JSON-RPC wire format ────────────────────────────────────────────────────
//
// LSP spec: "Content-Length: N\r\n\r\n<N bytes of JSON>"

fn write_message(writer: &mut impl Write, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

enum Frame {
    Msg(Value),
    Skip,
    Eof,
}

fn drain<R: Read>(reader: &mut R, mut n: usize) -> std::io::Result<()> {
    let mut buf = [0u8; 65536];
    while n > 0 {
        let want = n.min(buf.len());
        let got = reader.read(&mut buf[..want])?;
        if got == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        n -= got;
    }
    Ok(())
}

fn read_message<R: BufRead>(reader: &mut R) -> Frame {
    let mut content_length: usize = 0;

    // Read headers until blank line
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return Frame::Eof,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(colon) = trimmed.find(':') {
            let (name, val) = trimmed.split_at(colon);
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = val[1..].trim().parse().unwrap_or(0);
            }
        }
    }

    const MAX_LEN: usize = 32 * 1024 * 1024; // 32 MB
    if content_length == 0 {
        return Frame::Eof;
    }
    if content_length > MAX_LEN {
        return match drain(reader, content_length) {
            Ok(()) => Frame::Skip,
            Err(_) => Frame::Eof,
        };
    }

    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).is_err() {
        return Frame::Eof;
    }
    match serde_json::from_slice(&body) {
        Ok(v) => Frame::Msg(v),
        Err(_) => Frame::Skip,
    }
}

// ─── Session handles — Clone = just Arc clones, cheap ────────────────────────

// id → response sender (Ok=result, Err=server error message)
type PendingMap = Arc<Mutex<HashMap<u64, std::sync::mpsc::SyncSender<Result<Value, String>>>>>;

#[derive(Clone)]
struct LspHandles {
    stdin: Arc<Mutex<BufWriter<ChildStdin>>>,
    request_id: Arc<AtomicU64>,
    pending: PendingMap,
    // pushed diagnostics: uri → diagnostics
    diagnostics: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    // open document versions: uri → version
    doc_versions: Arc<Mutex<HashMap<String, i32>>>,
}

struct LspSession {
    handles: LspHandles,
    child: Child,
}

// ─── RPC helpers — release sessions lock before calling ──────────────────────

fn send_notification(h: &LspHandles, method: &str, params: Value) -> Result<(), String> {
    let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    write_message(
        &mut *h.stdin.lock().map_err(|_| "stdin lock poisoned")?,
        &msg,
    )
}

fn handle_server_request(stdin: &Arc<Mutex<BufWriter<ChildStdin>>>, msg: &Value, method: &str) {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);

    let result = if method == "workspace/configuration" {
        let count = msg
            .get("params")
            .and_then(|p| p.get("items"))
            .and_then(|i| i.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        Value::Array(vec![Value::Null; count])
    } else {
        Value::Null
    };

    let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    if let Ok(mut w) = stdin.lock() {
        let _ = write_message(&mut *w, &response);
    }
}

fn send_request(h: &LspHandles, method: &str, params: Value) -> Result<Value, String> {
    let id = h.request_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    h.pending
        .lock()
        .map_err(|_| "pending lock poisoned")?
        .insert(id, tx);

    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let write_res = h
        .stdin
        .lock()
        .map_err(|_| "stdin lock poisoned".to_string())
        .and_then(|mut w| write_message(&mut *w, &msg));
    if let Err(e) = write_res {
        let _ = h.pending.lock().map(|mut map| map.remove(&id));
        return Err(e);
    }

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(result) => result,
        Err(_) => {
            let _ = h.pending.lock().map(|mut map| map.remove(&id));
            Err(format!("timeout: {method}"))
        }
    }
}

// ─── Manager ─────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct LspManager {
    sessions: Mutex<HashMap<String, LspSession>>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn path_to_uri(path: &str) -> String {
    let p = std::path::Path::new(path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    // Normalize to forward slashes on Windows
    #[cfg(windows)]
    let abs_str = abs.to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let abs_str = abs.to_string_lossy().into_owned();

    let abs_str = if abs_str.starts_with('/') {
        abs_str
    } else {
        format!("/{abs_str}")
    };
    format!("file://{}", percent_encode_path(&abs_str))
}

fn percent_encode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        let keep =
            b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/' | b':');
        if keep {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(
                char::from_digit((b >> 4) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
            out.push(
                char::from_digit((b & 0xf) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
        }
    }
    out
}

fn diag_key(uri: &str) -> String {
    let path = uri
        .strip_prefix("file://")
        .map(|rest| rest.trim_start_matches('/'))
        .unwrap_or(uri);
    let decoded = percent_decode(path);
    let abs = if cfg!(windows) {
        decoded
    } else {
        format!("/{decoded}")
    };
    std::fs::canonicalize(&abs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(abs)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn language_id(file_path: &str) -> &'static str {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "rs" => "rust",
        "go" => "go",
        "rb" => "ruby",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" | "hh" => "cpp",
        "cs" => "csharp",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "mdx" => "markdown",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "vue" => "vue",
        "svelte" => "svelte",
        "astro" => "astro",
        "zig" => "zig",
        "lua" => "lua",
        "sh" | "bash" | "zsh" => "shellscript",
        _ => "plaintext",
    }
}

fn get_handles(state: &State<'_, LspManager>, id: &str) -> Result<LspHandles, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "sessions lock poisoned")?;
    sessions
        .get(id)
        .map(|s| s.handles.clone())
        .ok_or_else(|| format!("lsp session yok: {id}"))
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LspManager>,
    id: String,
    workspace_root: String,
    server_cmd: String,
    server_args: Vec<String>,
    initialization_options: Option<Value>,
) -> Result<String, String> {
    let lsp_stderr = if cfg!(debug_assertions) {
        Stdio::inherit()
    } else {
        Stdio::null()
    };
    let mut child = Command::new(&server_cmd)
        .args(&server_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(lsp_stderr)
        .current_dir(&workspace_root)
        .spawn()
        .map_err(|e| format!("{server_cmd} spawn hatası: {e}"))?;

    #[cfg(debug_assertions)]
    eprintln!(
        "[lsp] start id={id} root={workspace_root} cmd={server_cmd} args={:?}",
        server_args
    );

    let stdin = child.stdin.take().ok_or("stdin yok")?;
    let stdout = child.stdout.take().ok_or("stdout yok")?;

    let handles = LspHandles {
        stdin: Arc::new(Mutex::new(BufWriter::new(stdin))),
        request_id: Arc::new(AtomicU64::new(1)),
        pending: Arc::new(Mutex::new(HashMap::new())),
        diagnostics: Arc::new(Mutex::new(HashMap::new())),
        doc_versions: Arc::new(Mutex::new(HashMap::new())),
    };

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "sessions lock poisoned")?;
        if sessions.contains_key(&id) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("lsp zaten var: {id}"));
        }
        sessions.insert(
            id.clone(),
            LspSession {
                handles: handles.clone(),
                child,
            },
        );
    }

    let pending_clone = Arc::clone(&handles.pending);
    let diagnostics_clone = Arc::clone(&handles.diagnostics);
    let stdin_clone = Arc::clone(&handles.stdin);
    let app_clone = app.clone();
    let id_clone = id.clone();

    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let msg = match read_message(&mut reader) {
                Frame::Msg(m) => m,
                Frame::Skip => continue,
                Frame::Eof => break,
            };
            let has_id = msg.get("id").is_some();
            let method = msg.get("method").and_then(|m| m.as_str());

            match (has_id, method) {
                (true, Some(method)) => {
                    handle_server_request(&stdin_clone, &msg, method);
                }
                (true, None) => {
                    let req_id = msg.get("id").and_then(|v| v.as_u64());
                    if let Some(req_id) = req_id {
                        let sender = pending_clone
                            .lock()
                            .ok()
                            .and_then(|mut map| map.remove(&req_id));
                        if let Some(tx) = sender {
                            let payload = if let Some(err) = msg.get("error") {
                                let m = err
                                    .get("message")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("unknown LSP error");
                                Err(format!("LSP error: {m}"))
                            } else {
                                Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = tx.send(payload);
                        }
                    }
                }
                (false, Some("window/logMessage")) | (false, Some("window/showMessage")) =>
                {
                    #[cfg(debug_assertions)]
                    if let Some(params) = msg.get("params") {
                        let level = params.get("type").and_then(|v| v.as_u64()).unwrap_or(4);
                        let text = params.get("message").and_then(|m| m.as_str()).unwrap_or("");
                        let lvl = match level {
                            1 => "ERROR",
                            2 => "WARN",
                            3 => "INFO",
                            _ => "LOG",
                        };
                        eprintln!("[lsp:{id_clone}:{lvl}] {text}");
                    }
                }
                (false, Some("textDocument/publishDiagnostics")) => {
                    if let Some(params) = msg.get("params") {
                        let uri = params
                            .get("uri")
                            .and_then(|u| u.as_str())
                            .unwrap_or("")
                            .to_string();
                        let diags = params
                            .get("diagnostics")
                            .and_then(|d| d.as_array())
                            .cloned()
                            .unwrap_or_default();

                        if let Ok(mut map) = diagnostics_clone.lock() {
                            map.insert(diag_key(&uri), diags.clone());
                        }

                        let _ = app_clone.emit(
                            &format!("lsp:diagnostics:{id_clone}"),
                            json!({ "uri": uri, "diagnostics": diags }),
                        );
                    }
                }
                _ => {}
            }
        }

        if let Ok(mut map) = pending_clone.lock() {
            map.clear();
        }
        let dead = app_clone.try_state::<LspManager>().and_then(|mgr| {
            mgr.sessions
                .lock()
                .ok()
                .and_then(|mut s| s.remove(&id_clone))
        });
        if let Some(mut s) = dead {
            let _ = s.child.wait();
        }
    });

    // LSP initialize handshake — sessions lock olmadan yap
    let workspace_name = std::path::Path::new(&workspace_root)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string();

    let init_params = json!({
        "processId": std::process::id(),
        "rootUri": path_to_uri(&workspace_root),
        "initializationOptions": initialization_options.unwrap_or(Value::Null),
        "capabilities": {
            "textDocument": {
                "publishDiagnostics": {
                    "relatedInformation": true,
                    "versionSupport": false,
                },
                "hover": {
                    "contentFormat": ["plaintext", "markdown"],
                },
                "definition": {},
                "references": {},
                "documentSymbol": {},
                "codeAction": {
                    "dynamicRegistration": false,
                    "codeActionLiteralSupport": {
                        "codeActionKind": {
                            "valueSet": [
                                "", "quickfix", "refactor", "refactor.extract",
                                "refactor.inline", "refactor.rewrite", "source",
                                "source.organizeImports", "source.fixAll"
                            ]
                        }
                    },
                    "isPreferredSupport": true,
                    "disabledSupport": false,
                    "dataSupport": true,
                    "resolveSupport": { "properties": ["edit"] }
                },
                "synchronization": {
                    "dynamicRegistration": false,
                    "willSave": false,
                    "didSave": true,
                    "willSaveWaitUntil": false,
                },
            },
            "workspace": {
                "workspaceFolders": true,
            },
        },
        "workspaceFolders": [{
            "uri": path_to_uri(&workspace_root),
            "name": workspace_name,
        }],
    });

    let handshake = send_request(&handles, "initialize", init_params)
        .and_then(|_| send_notification(&handles, "initialized", json!({})));
    if let Err(e) = handshake {
        if let Some(mut s) = state.sessions.lock().ok().and_then(|mut m| m.remove(&id)) {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
        return Err(e);
    }

    Ok(id)
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspManager>, id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "sessions lock poisoned")?;
        sessions.remove(&id)
    };
    if let Some(mut session) = session {
        let _ = send_request(&session.handles, "shutdown", Value::Null);
        let _ = send_notification(&session.handles, "exit", Value::Null);
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn lsp_open_file(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let handles = get_handles(&state, &id)?;
    let uri = path_to_uri(&file_path);
    let lang = language_id(&file_path);

    let version = {
        let mut versions = handles
            .doc_versions
            .lock()
            .map_err(|_| "doc_versions lock poisoned")?;
        let v = versions.entry(uri.clone()).or_insert(0);
        *v += 1;
        *v
    };

    send_notification(
        &handles,
        "textDocument/didOpen",
        json!({
            "textDocument": {
                "uri": uri,
                "languageId": lang,
                "version": version,
                "text": content,
            }
        }),
    )
}

#[tauri::command]
pub fn lsp_change_file(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let handles = get_handles(&state, &id)?;
    let uri = path_to_uri(&file_path);

    let version = {
        let mut versions = handles
            .doc_versions
            .lock()
            .map_err(|_| "doc_versions lock poisoned")?;
        let v = versions.entry(uri.clone()).or_insert(0);
        *v += 1;
        *v
    };

    send_notification(
        &handles,
        "textDocument/didChange",
        json!({
            "textDocument": { "uri": uri, "version": version },
            "contentChanges": [{ "text": content }],
        }),
    )
}

#[tauri::command]
pub fn lsp_close_file(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
) -> Result<(), String> {
    let handles = get_handles(&state, &id)?;
    let uri = path_to_uri(&file_path);
    if let Ok(mut d) = handles.diagnostics.lock() {
        d.remove(&diag_key(&uri));
    }
    if let Ok(mut v) = handles.doc_versions.lock() {
        v.remove(&uri);
    }
    send_notification(
        &handles,
        "textDocument/didClose",
        json!({ "textDocument": { "uri": uri } }),
    )
}

#[tauri::command]
pub fn lsp_hover(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/hover",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "position": { "line": line, "character": character },
        }),
    )
}

#[tauri::command]
pub fn lsp_definition(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/definition",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "position": { "line": line, "character": character },
        }),
    )
}

#[tauri::command]
pub fn lsp_references(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/references",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "position": { "line": line, "character": character },
            "context": { "includeDeclaration": true },
        }),
    )
}

#[tauri::command]
pub fn lsp_implementation(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/implementation",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "position": { "line": line, "character": character },
        }),
    )
}

#[tauri::command]
pub fn lsp_document_symbol(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": path_to_uri(&file_path) } }),
    )
}

/// Proje genelinde query'e uyan sembolleri listele (workspace/symbol).
#[tauri::command]
pub fn lsp_workspace_symbol(
    state: State<'_, LspManager>,
    id: String,
    query: String,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(&handles, "workspace/symbol", json!({ "query": query }))
}

#[tauri::command]
pub fn lsp_prepare_call_hierarchy(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "textDocument/prepareCallHierarchy",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "position": { "line": line, "character": character },
        }),
    )
}

#[tauri::command]
pub fn lsp_incoming_calls(
    state: State<'_, LspManager>,
    id: String,
    item: Value,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "callHierarchy/incomingCalls",
        json!({ "item": item }),
    )
}

#[tauri::command]
pub fn lsp_outgoing_calls(
    state: State<'_, LspManager>,
    id: String,
    item: Value,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(
        &handles,
        "callHierarchy/outgoingCalls",
        json!({ "item": item }),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCodeActionArgs {
    id: String,
    file_path: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    diagnostics: Value,
}

#[tauri::command]
pub fn lsp_code_action(
    state: State<'_, LspManager>,
    args: LspCodeActionArgs,
) -> Result<Value, String> {
    let LspCodeActionArgs {
        id,
        file_path,
        start_line,
        start_character,
        end_line,
        end_character,
        diagnostics,
    } = args;
    let handles = get_handles(&state, &id)?;
    let diags = if diagnostics.is_array() {
        diagnostics
    } else {
        json!([])
    };
    send_request(
        &handles,
        "textDocument/codeAction",
        json!({
            "textDocument": { "uri": path_to_uri(&file_path) },
            "range": {
                "start": { "line": start_line, "character": start_character },
                "end": { "line": end_line, "character": end_character },
            },
            "context": { "diagnostics": diags },
        }),
    )
}

#[tauri::command]
pub fn lsp_resolve_code_action(
    state: State<'_, LspManager>,
    id: String,
    code_action: Value,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    send_request(&handles, "codeAction/resolve", code_action)
}

#[tauri::command]
pub fn lsp_execute_command(
    state: State<'_, LspManager>,
    id: String,
    command: String,
    arguments: Value,
) -> Result<Value, String> {
    let handles = get_handles(&state, &id)?;
    let args = if arguments.is_array() {
        arguments
    } else {
        json!([])
    };
    send_request(
        &handles,
        "workspace/executeCommand",
        json!({ "command": command, "arguments": args }),
    )
}

#[tauri::command]
pub fn lsp_get_diagnostics(
    state: State<'_, LspManager>,
    id: String,
    file_path: String,
) -> Result<Vec<Value>, String> {
    let handles = get_handles(&state, &id)?;
    let key = diag_key(&path_to_uri(&file_path));
    let map = handles
        .diagnostics
        .lock()
        .map_err(|_| "diagnostics lock poisoned")?;
    Ok(map.get(&key).cloned().unwrap_or_default())
}

//
//   const path = await invoke('lsp_server_installed', { id })          // Option<string>
//   const bin  = await invoke('lsp_install_server', { id, url, format, binName })
//   listen(`lsp:install:${id}`, ev => /* { downloaded, total } */)

fn lsp_bin_dir() -> Result<PathBuf, String> {
    // Windows USERPROFILE, POSIX HOME — editors.rs pattern'i (tek strateji).
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_var).map_err(|_| format!("{} env yok", home_var))?;
    let mut dir = PathBuf::from(home);
    dir.push(".codezal");
    dir.push("lsp");
    dir.push("bin");
    Ok(dir)
}

fn validate_server_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(())
    } else {
        Err(format!("geçersiz server id: {id}"))
    }
}

fn installed_bin_path(id: &str) -> Result<PathBuf, String> {
    validate_server_id(id)?;
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut p = lsp_bin_dir()?.join(id);
    #[cfg(windows)]
    p.set_extension("exe");
    Ok(p)
}

#[tauri::command]
pub fn lsp_platform() -> Value {
    json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[tauri::command]
pub fn lsp_server_installed(id: String) -> Option<String> {
    let p = installed_bin_path(&id).ok()?;
    if p.is_file() {
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[tauri::command]
pub fn lsp_check_command(cmd: String) -> bool {
    Command::new(&cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn lsp_install_server(
    app: AppHandle,
    id: String,
    url: String,
    format: String,
    bin_name: String,
) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err(format!(
            "güvensiz indirme şeması reddedildi, https zorunlu: {url}"
        ));
    }
    validate_server_id(&id)?;
    let dir = lsp_bin_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;

    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("indirme başlatılamadı: {e}"))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let mut reader = resp.into_reader();

    let archive_path = dir.join(format!("{id}.download"));
    let mut file = std::fs::File::create(&archive_path).map_err(|e| format!("create temp: {e}"))?;
    let mut buf = [0u8; 65536];
    let mut downloaded: u64 = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("write: {e}"))?;
        downloaded += n as u64;
        let _ = app.emit(
            &format!("lsp:install:{id}"),
            json!({ "downloaded": downloaded, "total": total }),
        );
    }
    drop(file);

    let bin_out = installed_bin_path(&id)?;

    let extract = (|| -> Result<(), String> {
        match format.as_str() {
            "gzip" => {
                let f = std::fs::File::open(&archive_path).map_err(|e| format!("open gz: {e}"))?;
                let mut dec = flate2::read::GzDecoder::new(f);
                let mut out =
                    std::fs::File::create(&bin_out).map_err(|e| format!("create bin: {e}"))?;
                std::io::copy(&mut dec, &mut out).map_err(|e| format!("gunzip: {e}"))?;
                Ok(())
            }
            "raw" => {
                std::fs::rename(&archive_path, &bin_out).map_err(|e| format!("rename: {e}"))?;
                Ok(())
            }
            "zip" => {
                let f = std::fs::File::open(&archive_path).map_err(|e| format!("open zip: {e}"))?;
                let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("zip aç: {e}"))?;
                let mut entry = zip
                    .by_name(&bin_name)
                    .map_err(|e| format!("zip içinde '{bin_name}' yok: {e}"))?;
                let mut out =
                    std::fs::File::create(&bin_out).map_err(|e| format!("create bin: {e}"))?;
                std::io::copy(&mut entry, &mut out).map_err(|e| format!("unzip: {e}"))?;
                Ok(())
            }
            "tar.gz" | "tar.xz" => {
                let f = std::fs::File::open(&archive_path).map_err(|e| format!("open tar: {e}"))?;
                let reader: Box<dyn Read> = if format == "tar.gz" {
                    Box::new(flate2::read::GzDecoder::new(f))
                } else {
                    Box::new(xz2::read::XzDecoder::new(f))
                };
                let mut ar = tar::Archive::new(reader);
                let suffix = format!("/{bin_name}");
                let mut found = false;
                for entry in ar.entries().map_err(|e| format!("tar oku: {e}"))? {
                    let mut e = entry.map_err(|e| format!("tar entry: {e}"))?;
                    let path = e
                        .path()
                        .map_err(|e| format!("tar path: {e}"))?
                        .to_string_lossy()
                        .into_owned();
                    if path == bin_name || path.ends_with(&suffix) {
                        let mut out = std::fs::File::create(&bin_out)
                            .map_err(|e| format!("create bin: {e}"))?;
                        std::io::copy(&mut e, &mut out).map_err(|e| format!("untar: {e}"))?;
                        found = true;
                        break;
                    }
                }
                if found {
                    Ok(())
                } else {
                    Err(format!("tar içinde '{bin_name}' yok"))
                }
            }
            other => Err(format!("bilinmeyen format: {other}")),
        }
    })();

    let _ = std::fs::remove_file(&archive_path);
    extract?;

    // Executable yap (unix).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&bin_out)
            .map_err(|e| format!("meta: {e}"))?
            .permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&bin_out, perm).map_err(|e| format!("chmod: {e}"))?;
    }

    Ok(bin_out.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn lsp_resource_dir(app: AppHandle) -> Option<String> {
    app.path()
        .resource_dir()
        .ok()
        .map(|p| p.join("lsp").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn lsp_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

pub fn shutdown_all(state: &LspManager) {
    if let Ok(mut sessions) = state.sessions.lock() {
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}
