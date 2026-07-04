// Local OpenAI/Ollama-compatible HTTP server.
//
//
//
//

use std::collections::VecDeque;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::inference::{self, LlmManager};


#[derive(Default)]
pub struct ServerState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    running: Option<Arc<AtomicBool>>,
    port: u16,
}

#[derive(serde::Serialize)]
pub struct ServerStatusDto {
    running: bool,
    port: u16,
}

static GEN_COUNTER: AtomicU64 = AtomicU64::new(0);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn next_gen_id() -> String {
    format!(
        "srv-{}-{}",
        now_secs(),
        GEN_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}


#[tauri::command]
pub fn inference_server_start(
    app: AppHandle,
    state: State<'_, ServerState>,
    port: Option<u16>,
    expose: Option<bool>,
) -> Result<u16, String> {
    let mut inner = state.0.lock().map_err(|_| "server state lock")?;
    if let Some(r) = &inner.running {
        if r.load(Ordering::Relaxed) {
            return Ok(inner.port);
        }
    }
    let port = port.unwrap_or(1456);
    let host = if expose.unwrap_or(false) {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let server =
        Server::http(format!("{host}:{port}")).map_err(|e| format!("bind {host}:{port}: {e}"))?;
    let running = Arc::new(AtomicBool::new(true));
    inner.running = Some(running.clone());
    inner.port = port;
    let app2 = app.clone();
    thread::spawn(move || accept_loop(server, running, app2));
    Ok(port)
}

#[tauri::command]
pub fn inference_server_stop(state: State<'_, ServerState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "server state lock")?;
    if let Some(r) = inner.running.take() {
        r.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn inference_server_status(state: State<'_, ServerState>) -> ServerStatusDto {
    match state.0.lock() {
        Ok(i) => ServerStatusDto {
            running: i
                .running
                .as_ref()
                .map(|r| r.load(Ordering::Relaxed))
                .unwrap_or(false),
            port: i.port,
        },
        Err(_) => ServerStatusDto {
            running: false,
            port: 0,
        },
    }
}


fn accept_loop(server: Server, running: Arc<AtomicBool>, app: AppHandle) {
    while running.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(req)) => {
                let app2 = app.clone();
                thread::spawn(move || handle(req, app2));
            }
            Ok(None) => {}
            Err(_) => break,
        }
    }
}


fn handle(mut request: Request, app: AppHandle) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("").to_string();

    if method == Method::Options {
        let _ = request.respond(empty_cors());
        return;
    }

    match (&method, path.as_str()) {
        (Method::Get, "/health") => respond_json(request, 200, &json!({ "status": "ok" })),
        (Method::Get, "/v1/models") => respond_json(request, 200, &openai_models()),
        (Method::Get, "/api/tags") => respond_json(request, 200, &ollama_tags()),
        (Method::Post, "/v1/chat/completions") | (Method::Post, "/api/chat") => {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                respond_json(
                    request,
                    400,
                    &json!({ "error": { "message": "gövde okunamadı" } }),
                );
                return;
            }
            let ollama = path == "/api/chat";
            handle_chat(request, app, body, ollama);
        }
        _ => respond_json(
            request,
            404,
            &json!({ "error": { "message": format!("bilinmeyen: {path}") } }),
        ),
    }
}


enum BridgeMsg {
    Delta(Value),
    Done(String),
    Error(String),
}

// receiver delta/done/error verir. Dinleyici done/error'da kendini unlisten eder.
fn start_bridge(
    app: &AppHandle,
    gen_id: &str,
    body: String,
) -> Result<Receiver<BridgeMsg>, String> {
    let event = format!("llm:chat:{gen_id}");
    let (tx, rx) = mpsc::channel::<BridgeMsg>();
    let id_cell: Arc<Mutex<Option<tauri::EventId>>> = Arc::new(Mutex::new(None));
    let app_l = app.clone();
    let id_l = id_cell.clone();

    let eid = app.listen(event, move |ev| {
        let val: Value = match serde_json::from_str(ev.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };
        match val.get("kind").and_then(|k| k.as_str()) {
            Some("oai_delta") => {
                if let Some(j) = val.get("json").and_then(|j| j.as_str()) {
                    if let Ok(delta) = serde_json::from_str::<Value>(j) {
                        let _ = tx.send(BridgeMsg::Delta(delta));
                    }
                }
            }
            Some("done") => {
                let fr = val
                    .get("finish_reason")
                    .and_then(|f| f.as_str())
                    .unwrap_or("stop")
                    .to_string();
                let _ = tx.send(BridgeMsg::Done(fr));
                if let Some(id) = id_l.lock().ok().and_then(|mut g| g.take()) {
                    app_l.unlisten(id);
                }
            }
            Some("error") => {
                let m = val
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("error")
                    .to_string();
                let _ = tx.send(BridgeMsg::Error(m));
                if let Some(id) = id_l.lock().ok().and_then(|mut g| g.take()) {
                    app_l.unlisten(id);
                }
            }
            _ => {}
        }
    });
    *id_cell.lock().map_err(|_| "id lock")? = Some(eid);

    let args: inference::LlmChatArgs = serde_json::from_value(json!({
        "genId": gen_id,
        "request": body,
        "flashAttention": Value::Null,
        "nCtx": Value::Null,
    }))
    .map_err(|e| format!("bad chat args: {e}"))?;
    inference::llm_chat(app.clone(), app.state::<LlmManager>(), args)?;
    Ok(rx)
}

fn handle_chat(request: Request, app: AppHandle, body: String, ollama: bool) {
    let stream = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("stream").and_then(|s| s.as_bool()))
        // Ollama default'u stream=true; OpenAI default'u stream=false.
        .unwrap_or(ollama);
    let model = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| "local".into());
    let gen_id = next_gen_id();
    let created = now_secs();

    let rx = match start_bridge(&app, &gen_id, body) {
        Ok(rx) => rx,
        Err(e) => {
            respond_json(request, 503, &json!({ "error": { "message": e } }));
            return;
        }
    };

    if stream {
        let reader = SseReader::new(rx, gen_id, model, created, ollama);
        let headers = vec![
            header(
                "Content-Type",
                if ollama {
                    "application/x-ndjson"
                } else {
                    "text/event-stream"
                },
            ),
            header("Cache-Control", "no-cache"),
            header("Access-Control-Allow-Origin", "*"),
        ];
        let response = Response::new(StatusCode(200), headers, reader, None, None);
        let _ = request.respond(response);
    } else {
        let mut content = String::new();
        let mut finish = "stop".to_string();
        let mut err: Option<String> = None;
        for msg in rx.iter() {
            match msg {
                BridgeMsg::Delta(d) => {
                    if let Some(c) = d.get("content").and_then(|c| c.as_str()) {
                        content.push_str(c);
                    }
                }
                BridgeMsg::Done(fr) => {
                    finish = fr;
                    break;
                }
                BridgeMsg::Error(m) => {
                    err = Some(m);
                    break;
                }
            }
        }
        if let Some(m) = err {
            respond_json(request, 500, &json!({ "error": { "message": m } }));
            return;
        }
        let resp = if ollama {
            json!({
                "model": model,
                "created_at": created,
                "message": { "role": "assistant", "content": content },
                "done": true,
                "done_reason": finish,
            })
        } else {
            json!({
                "id": gen_id,
                "object": "chat.completion",
                "created": created,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": { "role": "assistant", "content": content },
                    "finish_reason": finish,
                }],
            })
        };
        respond_json(request, 200, &resp);
    }
}

struct SseReader {
    rx: Receiver<BridgeMsg>,
    gen_id: String,
    model: String,
    created: u64,
    ollama: bool,
    queue: VecDeque<u8>,
    role_sent: bool,
    finished: bool,
}

impl SseReader {
    fn new(
        rx: Receiver<BridgeMsg>,
        gen_id: String,
        model: String,
        created: u64,
        ollama: bool,
    ) -> Self {
        SseReader {
            rx,
            gen_id,
            model,
            created,
            ollama,
            queue: VecDeque::new(),
            role_sent: false,
            finished: false,
        }
    }

    fn push(&mut self, bytes: Vec<u8>) {
        self.queue.extend(bytes);
    }

    fn frame_delta(&self, delta: &Value, finish: Option<&str>) -> Vec<u8> {
        if self.ollama {
            let content = delta.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let obj = json!({
                "model": self.model,
                "created_at": self.created,
                "message": { "role": "assistant", "content": content },
                "done": false,
            });
            format!("{obj}\n").into_bytes()
        } else {
            let obj = json!({
                "id": self.gen_id,
                "object": "chat.completion.chunk",
                "created": self.created,
                "model": self.model,
                "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }],
            });
            format!("data: {obj}\n\n").into_bytes()
        }
    }

    fn frame_done(&self, finish: &str) -> Vec<u8> {
        if self.ollama {
            let obj = json!({
                "model": self.model,
                "created_at": self.created,
                "message": { "role": "assistant", "content": "" },
                "done": true,
                "done_reason": finish,
            });
            format!("{obj}\n").into_bytes()
        } else {
            let chunk = self.frame_delta(&json!({}), Some(finish));
            let mut out = chunk;
            out.extend_from_slice(b"data: [DONE]\n\n");
            out
        }
    }
}

impl Read for SseReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if !self.queue.is_empty() {
                let n = std::cmp::min(buf.len(), self.queue.len());
                for slot in buf.iter_mut().take(n) {
                    *slot = self.queue.pop_front().unwrap();
                }
                return Ok(n);
            }
            if self.finished {
                return Ok(0); // EOF
            }
            if !self.role_sent {
                self.role_sent = true;
                if !self.ollama {
                    let b = self.frame_delta(&json!({ "role": "assistant" }), None);
                    self.push(b);
                    continue;
                }
            }
            match self.rx.recv() {
                Ok(BridgeMsg::Delta(d)) => {
                    let b = self.frame_delta(&d, None);
                    self.push(b);
                }
                Ok(BridgeMsg::Done(fr)) => {
                    let b = self.frame_done(&fr);
                    self.push(b);
                    self.finished = true;
                }
                Ok(BridgeMsg::Error(m)) => {
                    let b = self.frame_delta(
                        &json!({ "content": format!("\n[error] {m}") }),
                        Some("stop"),
                    );
                    self.push(b);
                    let d = self.frame_done("stop");
                    self.push(d);
                    self.finished = true;
                }
                Err(_) => {
                    self.finished = true;
                }
            }
        }
    }
}

// ── Model listeleme ──────────────────────────────────────────────────────────

fn openai_models() -> Value {
    let data: Vec<Value> = inference::llm_list_models()
        .unwrap_or_default()
        .into_iter()
        .map(|name| json!({ "id": name, "object": "model", "created": 0, "owned_by": "codezal" }))
        .collect();
    json!({ "object": "list", "data": data })
}

fn ollama_tags() -> Value {
    let models: Vec<Value> = inference::llm_list_models()
        .unwrap_or_default()
        .into_iter()
        .map(|name| json!({ "name": name, "model": name, "size": 0, "details": {} }))
        .collect();
    json!({ "models": models })
}


fn header(key: &str, value: &str) -> Header {
    Header::from_bytes(key.as_bytes(), value.as_bytes())
        .unwrap_or_else(|_| Header::from_bytes(&b"X-Invalid"[..], &b"1"[..]).unwrap())
}

fn respond_json(request: Request, status: u16, body: &Value) {
    let data = body.to_string();
    let response = Response::from_string(data)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", "application/json"))
        .with_header(header("Access-Control-Allow-Origin", "*"));
    let _ = request.respond(response);
}

fn empty_cors() -> Response<std::io::Empty> {
    Response::empty(StatusCode(204))
        .with_header(header("Access-Control-Allow-Origin", "*"))
        .with_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
        .with_header(header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
        ))
}
