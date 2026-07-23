//
// Architecture: a single long-lived WORKER THREAD owns the LlamaBackend and the
// loaded LlamaModel. Commands talk to it over an mpsc channel. The model never
// crosses a thread boundary, so we sidestep all Send/Sync concerns — only plain
// data (paths, prompts, the cancel flag, the AppHandle) is sent to the worker.
//
// Two surfaces:
//     streams `llm:token:{id}` / `llm:done:{id}` / `llm:error:{id}` events.
//     the model's own chat template via llama-cpp-2's oai module, generates, and
//     streams structured `llm:chat:{id}` ChatEvent items. The JS side (localLlmFetch)
//     frames these into OpenAI SSE so the existing @ai-sdk/openai-compatible adapter
//     consumes them with no TCP server. Plus llm_list_models for the model picker.
//
// Streaming uses Tauri EVENTS (same pattern as pty.rs). JS must register listeners
// BEFORE invoking (see src/lib/tauri-events.ts) — Tauri events are not buffered.
//
// Everything llama-cpp-2 specific lives in `imp` behind `#[cfg(feature = "local-llm")]`.
// With the feature OFF the commands still exist (so generate_handler! stays static)
// but return an error / empty — and llama.cpp is never compiled.
#![cfg_attr(not(feature = "local-llm"), allow(dead_code))]

use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, State};

type CancelMap = Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>;

#[cfg_attr(feature = "local-llm", allow(dead_code))]
const FEATURE_OFF: &str =
    "Codezal was built without the `local-llm` feature. Rebuild with a backend, e.g. \
     `npm run tauri dev -- -f llm-metal` (macOS) or `-f llm-vulkan` (Windows).";

#[derive(Clone, serde::Serialize)]
struct TokenPayload {
    text: String,
}
#[derive(Clone, serde::Serialize)]
struct DonePayload {
    tokens: usize,
    cancelled: bool,
    tokens_per_sec: f64,
}
#[derive(Clone, serde::Serialize)]
struct ErrorPayload {
    message: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ChatEvent {
    /// A raw OpenAI-format delta object JSON from llama.cpp's streaming chat
    /// parser (content or tool_calls). The JS bridge wraps it in an SSE chunk.
    OaiDelta {
        json: String,
    },
    Done {
        finish_reason: String,
        tokens_per_sec: f64,
        tokens: usize,
        ttft_ms: u64,
    },
    /// Non-fatal notice for the UI (toast); generation continues. Emitted when the
    /// context window is clamped to fit memory, so the user understands the drop.
    Notice {
        requested: u32,
        effective: u32,
        model: String,
        model_gb: f64,
    },
    ModelInfo {
        requested_ctx: u32,
        effective_ctx: u32,
        n_train: u32,
        weights: u64,
        kv: u64,
        compute: u64,
        ram: u64,
    },
    Error {
        message: String,
    },
}

/// Request to the worker thread. Only plain Send data — no llama types here, so
/// this enum compiles with or without the feature.
#[derive(Clone)]
enum SpeculativeMode {
    Off,
    Mtp,
}

#[derive(Clone)]
struct SpeculativeConfig {
    mode: SpeculativeMode,
    draft_tokens: u32,
    draft_model: Option<String>,
}

enum Req {
    Load {
        path: String,
        gpu_layers: u32,
        #[allow(dead_code)] // dev-panel load; the chat session uses a fixed window
        n_ctx: u32,
        reply: Sender<Result<(), String>>,
    },
    Generate {
        gen_id: String,
        prompt: String,
        max_tokens: usize,
        cancel: Arc<AtomicBool>,
        cancel_map: CancelMap,
    },
    Chat {
        gen_id: String,
        request: String,    // raw OpenAI chat-completions request JSON
        flash_attn: i32,    // llama.cpp flash-attn policy (-1 auto / 0 off / 1 on)
        n_ctx: u32,         // context window for the persistent session
        batch_size: u32,    // prompt prefill batch size
        threads: i32,       // decode threads
        batch_threads: i32, // prefill/batch threads
        speculative: SpeculativeConfig,
        kv_type: String, // KV cache ggml type ("f16"/"q8_0"/"q4_0")
        cancel: Arc<AtomicBool>,
        cancel_map: CancelMap,
    },
}

pub struct LlmManager {
    /// Channel to the worker thread; None until the first command spawns it.
    tx: Mutex<Option<Sender<Req>>>,
    /// Cancel flags keyed by generation id. Local inference is a single worker,
    /// but multi-session UI can queue requests; cancellation must target the
    /// stream that owns the abort, not whichever request was submitted last.
    cancel: CancelMap,
    /// Fully-qualified HashMap so the top level needs no import (imp already
    /// imports its own — a top-level `use` would clash via `use super::*`).
    downloads: Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
}

impl Default for LlmManager {
    fn default() -> Self {
        Self {
            tx: Mutex::new(None),
            cancel: Arc::new(Mutex::new(std::collections::HashMap::new())),
            downloads: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmLoadArgs {
    path: String,
    gpu_layers: Option<u32>,
    n_ctx: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmGenArgs {
    gen_id: String,
    prompt: String,
    max_tokens: Option<usize>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatArgs {
    gen_id: String,
    /// The OpenAI chat-completions request body, stringified by the JS bridge.
    request: String,
    /// Flash-attention policy: "enabled" (default) | "auto" | "disabled".
    flash_attention: Option<String>,
    /// Context window for the persistent session (default 16384).
    n_ctx: Option<u32>,
    /// Prompt prefill batch size. Larger values reduce decode calls for long prompts.
    batch_size: Option<u32>,
    /// Decode threads. 0 or missing means auto.
    threads: Option<i32>,
    /// Prefill/batch threads. 0 or missing means auto.
    batch_threads: Option<i32>,
    /// Speculative decoding mode: "off" (default) | "mtp".
    speculative_mode: Option<String>,
    /// Maximum draft tokens per target verification step.
    draft_tokens: Option<u32>,
    /// Optional MTP GGUF basename/path. Empty means discover `mtp-*` sibling.
    draft_model: Option<String>,
    /// KV cache type: "f16" (default) | "q8_0" | "q4_0" — quantize to fit larger windows.
    kv_cache: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmCancelArgs {
    /// Caller-generated chat/generation id. Missing means "cancel all" for
    /// backward compatibility with older callers.
    gen_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmDownloadArgs {
    /// Caller-generated id; names the progress event `llm:download:{id}`.
    id: String,
    /// HF repo, e.g. "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF".
    repo: String,
    /// File path within the repo (a subfolder is allowed for split quants).
    path: String,
    /// Git revision; defaults to "main".
    revision: Option<String>,
}

/// One local model file (basename + byte size) for the manager UI. Defined at
/// the top level (not in `imp`) so the `llm_models_info` command signature is
/// identical with or without the feature.
#[derive(Clone, serde::Serialize)]
pub struct ModelInfo {
    name: String,
    size: u64,
}

// ── Commands (always registered; bodies gated by the feature) ────────────────

#[tauri::command]
pub fn llm_load(
    app: AppHandle,
    state: State<'_, LlmManager>,
    args: LlmLoadArgs,
) -> Result<(), String> {
    #[cfg(feature = "local-llm")]
    {
        imp::load(app, state, args)
    }
    #[cfg(not(feature = "local-llm"))]
    {
        let _ = (app, state, args);
        Err(FEATURE_OFF.to_string())
    }
}

#[tauri::command]
pub fn llm_generate_stream(state: State<'_, LlmManager>, args: LlmGenArgs) -> Result<(), String> {
    #[cfg(feature = "local-llm")]
    {
        imp::generate(state, args)
    }
    #[cfg(not(feature = "local-llm"))]
    {
        let _ = (state, args);
        Err(FEATURE_OFF.to_string())
    }
}

#[tauri::command]
pub fn llm_chat(
    app: AppHandle,
    state: State<'_, LlmManager>,
    args: LlmChatArgs,
) -> Result<(), String> {
    #[cfg(feature = "local-llm")]
    {
        imp::chat(app, state, args)
    }
    #[cfg(not(feature = "local-llm"))]
    {
        let _ = (app, state, args);
        Err(FEATURE_OFF.to_string())
    }
}

/// List GGUF files in the local models dir (basenames). Feeds the model picker.
/// Returns empty (not an error) when the feature is off so the UI degrades cleanly.
#[tauri::command]
pub fn llm_list_models() -> Result<Vec<String>, String> {
    #[cfg(feature = "local-llm")]
    {
        imp::list_models()
    }
    #[cfg(not(feature = "local-llm"))]
    {
        Ok(Vec::new())
    }
}

/// Cancel a generation by id (no-op if unknown). Feature-independent — it only
/// flips an atomic flag the worker observes each token. Missing id cancels all
/// currently tracked generations for backward compatibility.
#[tauri::command]
pub fn llm_cancel(state: State<'_, LlmManager>, args: Option<LlmCancelArgs>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Ok(map) = state.cancel.lock() {
        if let Some(gen_id) = args.and_then(|a| a.gen_id) {
            if let Some(c) = map.get(&gen_id) {
                c.store(true, Ordering::Relaxed);
            }
        } else {
            for c in map.values() {
                c.store(true, Ordering::Relaxed);
            }
        }
    }
    Ok(())
}

/// Download a GGUF from Hugging Face into the models dir. Returns immediately;
/// progress streams as `llm:download:{id}` events (progress/done/cancelled/error).
#[tauri::command]
pub fn llm_download(
    app: AppHandle,
    state: State<'_, LlmManager>,
    args: LlmDownloadArgs,
) -> Result<(), String> {
    #[cfg(feature = "local-llm")]
    {
        imp::download(app, state, args)
    }
    #[cfg(not(feature = "local-llm"))]
    {
        let _ = (app, state, args);
        Err(FEATURE_OFF.to_string())
    }
}

/// Cancel an in-flight model download by id (no-op if unknown). Feature-independent
/// — it only flips an atomic flag the download thread observes each chunk.
#[tauri::command]
pub fn llm_cancel_download(state: State<'_, LlmManager>, id: String) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Ok(map) = state.downloads.lock() {
        if let Some(c) = map.get(&id) {
            c.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HfGgufFile {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HfRepoHit {
    pub id: String,
    pub downloads: u64,
}

fn hf_api_json(url: &str) -> Result<serde_json::Value, String> {
    if !url.starts_with("https://huggingface.co/") {
        return Err("yalnız huggingface.co".into());
    }
    let body = ureq::get(url)
        .set("User-Agent", "codezal")
        .call()
        .map_err(|e| format!("HF API: {e}"))?
        .into_string()
        .map_err(|e| format!("HF API gövde: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("HF API JSON: {e}"))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HfListing {
    pub params: Option<u64>,
    pub files: Vec<HfGgufFile>,
}

#[tauri::command]
pub fn hf_list_gguf(repo: String) -> Result<HfListing, String> {
    let repo = repo.trim().trim_matches('/');
    if repo.is_empty() || repo.contains("..") || !repo.contains('/') {
        return Err("geçersiz repo (org/model bekleniyor)".into());
    }
    let arr = hf_api_json(&format!(
        "https://huggingface.co/api/models/{repo}/tree/main?recursive=true"
    ))?;
    let mut files = Vec::new();
    if let Some(items) = arr.as_array() {
        for it in items {
            if it.get("type").and_then(|t| t.as_str()) != Some("file") {
                continue;
            }
            let path = match it.get("path").and_then(|p| p.as_str()) {
                Some(p) if p.ends_with(".gguf") => p.to_string(),
                _ => continue,
            };
            let size = it
                .get("lfs")
                .and_then(|l| l.get("size"))
                .and_then(|s| s.as_u64())
                .or_else(|| it.get("size").and_then(|s| s.as_u64()))
                .unwrap_or(0);
            files.push(HfGgufFile { path, size });
        }
    }
    files.sort_by(|a, b| a.size.cmp(&b.size));
    let params = hf_api_json(&format!("https://huggingface.co/api/models/{repo}"))
        .ok()
        .and_then(|v| {
            v.get("safetensors")
                .and_then(|s| s.get("total"))
                .and_then(|t| t.as_u64())
        });
    Ok(HfListing { params, files })
}

#[tauri::command]
pub fn llm_system_ram() -> u64 {
    #[cfg(feature = "local-llm")]
    {
        imp::total_physical_ram()
    }
    #[cfg(not(feature = "local-llm"))]
    {
        0
    }
}

#[tauri::command]
pub fn hf_search_gguf(query: String) -> Result<Vec<HfRepoHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let enc: String = q
        .bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    let url = format!(
        "https://huggingface.co/api/models?search={enc}&filter=gguf&limit=12&sort=downloads&direction=-1"
    );
    let arr = hf_api_json(&url)?;
    let mut out = Vec::new();
    if let Some(items) = arr.as_array() {
        for it in items {
            if let Some(id) = it.get("id").and_then(|i| i.as_str()) {
                let downloads = it.get("downloads").and_then(|d| d.as_u64()).unwrap_or(0);
                out.push(HfRepoHit {
                    id: id.to_string(),
                    downloads,
                });
            }
        }
    }
    Ok(out)
}

/// Delete a GGUF from the models dir. `file` must be a bare `.gguf` basename.
#[tauri::command]
pub fn llm_delete_model(file: String) -> Result<(), String> {
    #[cfg(feature = "local-llm")]
    {
        imp::delete_model(file)
    }
    #[cfg(not(feature = "local-llm"))]
    {
        let _ = file;
        Err(FEATURE_OFF.to_string())
    }
}

/// List local models with sizes (manager UI). Empty when the feature is off.
#[tauri::command]
pub fn llm_models_info() -> Result<Vec<ModelInfo>, String> {
    #[cfg(feature = "local-llm")]
    {
        imp::models_info()
    }
    #[cfg(not(feature = "local-llm"))]
    {
        Ok(Vec::new())
    }
}

// ── Real implementation (only with the feature) ──────────────────────────────

#[cfg(feature = "local-llm")]
mod imp {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::Ordering;
    use std::sync::mpsc::{channel, Receiver};

    use tauri::Emitter;

    use base64::Engine as _;
    use llama_cpp_2::context::params::{KvCacheType, LlamaContextParams, RopeScalingType};
    use llama_cpp_2::context::LlamaContext;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel};
    use llama_cpp_2::mtmd::{
        mtmd_default_marker, MtmdBitmap, MtmdContext, MtmdContextParams, MtmdInputText,
    };
    use llama_cpp_2::sampling::LlamaSampler;
    use llama_cpp_2::token::LlamaToken;
    use std::collections::HashMap;
    use std::num::NonZeroU32;

    enum StopReason {
        Eos,
        Max,
        Cancelled,
    }

    /// A warm chat context kept alive across turns so its KV cache can be reused —
    /// only the new suffix of each turn's prompt is prefilled. The model + backend
    /// are leaked to 'static so the context can be stored here.
    struct ChatSession {
        path: String,
        ctx: LlamaContext<'static>,
        cached: Vec<LlamaToken>, // tokens currently in the KV cache (positions 0..len)
        n_ctx: u32,
        /// Flash-attention policy this context was built with (-1 auto / 0 off /
        /// 1 on). Changing it rebuilds the session, like a model swap.
        flash_attn: i32,
        /// Prompt prefill batch size this context was built with.
        batch_size: u32,
        /// Decode threads this context was built with.
        threads: i32,
        /// Prefill/batch threads this context was built with.
        batch_threads: i32,
        /// KV cache ggml type ("f16"/"q8_0"/"q4_0"); rebuild on change.
        kv_type: String,
    }

    impl ChatSession {
        /// Decode `batch`; on failure (e.g. a Metal OOM) reset our cached/KV state
        /// so the NEXT turn rebuilds the prompt from scratch instead of erroring on
        /// inconsistent sequence positions (cached says N, KV holds fewer).
        fn decode_or_reset(&mut self, batch: &mut LlamaBatch) -> Result<(), String> {
            if let Err(e) = self.ctx.decode(batch) {
                self.cached.clear();
                let _ = self.ctx.clear_kv_cache();
                return Err(format!("decode: {e}"));
            }
            Ok(())
        }
    }

    struct DraftSession {
        path: String,
        ctx: LlamaContext<'static>,
        cached: Vec<LlamaToken>,
        n_ctx: u32,
        flash_attn: i32,
        batch_size: u32,
        threads: i32,
        batch_threads: i32,
        kv_type: String,
    }

    impl DraftSession {
        fn decode_or_reset(&mut self, batch: &mut LlamaBatch) -> Result<(), String> {
            if let Err(e) = self.ctx.decode(batch) {
                self.cached.clear();
                let _ = self.ctx.clear_kv_cache();
                return Err(format!("draft decode: {e}"));
            }
            Ok(())
        }
    }

    fn prefill(
        session: &mut ChatSession,
        tokens: &[LlamaToken],
        start: usize,
        batch_size: usize,
    ) -> Result<i32, String> {
        let batch_size = batch_size.max(1);
        let mut batch = LlamaBatch::new(batch_size, 1);
        let mut last_logit_idx = 0i32;
        let mut i = start;
        while i < tokens.len() {
            let end = (i + batch_size).min(tokens.len());
            batch.clear();
            let mut bi = 0i32;
            for j in i..end {
                let is_last = j == tokens.len() - 1;
                batch
                    .add(tokens[j], j as i32, &[0], is_last)
                    .map_err(|e| format!("batch.add: {e}"))?;
                if is_last {
                    last_logit_idx = bi;
                }
                bi += 1;
            }
            session.decode_or_reset(&mut batch)?;
            i = end;
        }
        Ok(last_logit_idx)
    }

    fn prefill_draft(
        session: &mut DraftSession,
        tokens: &[LlamaToken],
        start: usize,
    ) -> Result<i32, String> {
        let batch_size = (session.batch_size as usize).max(1);
        let mut batch = LlamaBatch::new(batch_size, 1);
        let mut last_logit_idx = 0i32;
        let mut i = start;
        while i < tokens.len() {
            let end = (i + batch_size).min(tokens.len());
            batch.clear();
            let mut bi = 0i32;
            for j in i..end {
                let is_last = j == tokens.len() - 1;
                batch
                    .add(tokens[j], j as i32, &[0], is_last)
                    .map_err(|e| format!("draft batch.add: {e}"))?;
                if is_last {
                    last_logit_idx = bi;
                }
                bi += 1;
            }
            session.decode_or_reset(&mut batch)?;
            i = end;
        }
        Ok(last_logit_idx)
    }

    fn greedy_token(ctx: &LlamaContext<'static>, idx: i32) -> LlamaToken {
        let logits = ctx.get_logits_ith(idx);
        let mut best = 0usize;
        let mut best_logit = f32::NEG_INFINITY;
        for (i, logit) in logits.iter().enumerate() {
            if *logit > best_logit {
                best = i;
                best_logit = *logit;
            }
        }
        LlamaToken::new(best as i32)
    }

    fn sync_draft_to_tokens(
        session: &mut DraftSession,
        tokens: &[LlamaToken],
    ) -> Result<i32, String> {
        if tokens.is_empty() {
            return Err("draft sync got zero tokens".into());
        }
        let mut common = 0usize;
        while common < session.cached.len()
            && common < tokens.len()
            && session.cached[common] == tokens[common]
        {
            common += 1;
        }
        let common = common.min(tokens.len() - 1);
        session
            .ctx
            .clear_kv_cache_seq(Some(0), Some(common as u32), None)
            .map_err(|e| format!("draft kv trim: {e}"))?;
        let idx = match prefill_draft(session, tokens, common) {
            Ok(idx) => idx,
            Err(_) if common > 0 => {
                session.ctx.clear_kv_cache();
                session.cached.clear();
                prefill_draft(session, tokens, 0)?
            }
            Err(e) => return Err(e),
        };
        session.cached = tokens.to_vec();
        Ok(idx)
    }

    fn draft_propose(
        session: &mut DraftSession,
        sample_idx: i32,
        mut n_cur: i32,
        max_tokens: usize,
        cancel: &Arc<AtomicBool>,
    ) -> Result<Vec<LlamaToken>, String> {
        let model = session.ctx.model;
        let mut out = Vec::new();
        let mut idx = sample_idx;
        let mut batch = LlamaBatch::new(1, 1);
        while out.len() < max_tokens && !cancel.load(Ordering::Relaxed) {
            let next = greedy_token(&session.ctx, idx);
            if model.is_eog_token(next) {
                break;
            }
            out.push(next);
            session.cached.push(next);
            batch.clear();
            batch
                .add(next, n_cur, &[0], true)
                .map_err(|e| format!("draft batch.add: {e}"))?;
            n_cur += 1;
            idx = 0;
            session.decode_or_reset(&mut batch)?;
        }
        Ok(out)
    }

    /// Load a model once per path (leaked to 'static, reused on swap so the same
    /// file is never reloaded). Note: leaked models stay resident until exit —
    /// fine for a handful of models; restart to reclaim if many are tried.
    fn get_model(
        backend: &'static LlamaBackend,
        models: &mut HashMap<String, &'static LlamaModel>,
        path: &str,
        gpu_layers: u32,
    ) -> Result<&'static LlamaModel, String> {
        if let Some(m) = models.get(path) {
            return Ok(*m);
        }
        let load = |layers: u32| {
            let params = LlamaModelParams::default().with_n_gpu_layers(layers);
            LlamaModel::load_from_file(backend, Path::new(path), &params)
                .map_err(|e| format!("load {path} (gpu_layers={layers}): {e}"))
        };
        let m = match load(gpu_layers) {
            Ok(m) => m,
            Err(gpu_err) if gpu_layers > 0 => {
                log::warn!("GPU model load failed ({gpu_err}); retrying on CPU");
                load(0)?
            }
            Err(e) => return Err(e),
        };
        let leaked: &'static LlamaModel = Box::leak(Box::new(m));
        models.insert(path.to_string(), leaked);
        Ok(leaked)
    }

    /// Single-model residency: free every resident model except `keep` — first
    /// dropping the persistent session if it belongs to one being freed (its
    /// context borrows that model) and clearing gen_model if it points there.
    /// Two large GGUFs can't coexist in a tight Metal budget (e.g. 12 GB + 4 GB
    /// exceeds the ~13.6 GB working set on an 18 GB Mac → decode OOM), and models
    /// are `Box::leak`'d for the persistent context, so we free the leak by hand.
    fn evict_other_models(
        models: &mut HashMap<String, &'static LlamaModel>,
        session: &mut Option<ChatSession>,
        gen_model: &mut Option<&'static LlamaModel>,
        keep: &str,
    ) {
        if session.as_ref().map(|s| s.path != keep).unwrap_or(false) {
            *session = None; // drop the context — it borrows a model we're about to free
        }
        let stale: Vec<String> = models
            .keys()
            .filter(|k| k.as_str() != keep)
            .cloned()
            .collect();
        for p in stale {
            if let Some(m) = models.remove(&p) {
                if matches!(*gen_model, Some(g) if std::ptr::eq(g, m)) {
                    *gen_model = None; // gen_model pointed at the model we're freeing
                }
                // SAFETY: `m` came from `Box::leak(Box::new(..))` in get_model; the
                // only live borrows (the session context and gen_model) were just
                // released, so reconstructing and dropping the Box frees the weights
                // + Metal buffers. Runs only when switching models, never mid-decode.
                unsafe {
                    drop(Box::from_raw(m as *const LlamaModel as *mut LlamaModel));
                }
            }
        }
    }

    fn evict_draft_models(
        models: &mut HashMap<String, &'static LlamaModel>,
        session: &mut Option<DraftSession>,
        keep: &str,
    ) {
        if session.as_ref().map(|s| s.path != keep).unwrap_or(false) {
            *session = None;
        }
        let stale: Vec<String> = models
            .keys()
            .filter(|k| k.as_str() != keep)
            .cloned()
            .collect();
        for p in stale {
            if let Some(m) = models.remove(&p) {
                unsafe {
                    drop(Box::from_raw(m as *const LlamaModel as *mut LlamaModel));
                }
            }
        }
    }

    fn models_dir() -> PathBuf {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = std::env::var(home_var).unwrap_or_default();
        PathBuf::from(home)
            .join(".cache")
            .join("codezal")
            .join("models")
    }

    /// A model ref is either an absolute/relative path (contains a separator) or a
    /// bare basename resolved against the models dir.
    fn resolve_model_path(model_ref: &str) -> String {
        if model_ref.contains('/') || model_ref.contains('\\') {
            model_ref.to_string()
        } else {
            models_dir().join(model_ref).to_string_lossy().into_owned()
        }
    }

    fn shard_base(name: &str) -> Option<&str> {
        let stem = name.strip_suffix(".gguf")?;
        let (rest, last) = stem.rsplit_once('-')?; // "00003"
        let (rest2, of) = rest.rsplit_once('-')?; // "of"
        let (base, first) = rest2.rsplit_once('-')?; // "00001"
        let five_digit = |s: &str| s.len() == 5 && s.bytes().all(|b| b.is_ascii_digit());
        if of == "of" && five_digit(first) && five_digit(last) {
            Some(base)
        } else {
            None
        }
    }

    /// OOM/freeze eder.
    fn model_total_size(path: &str) -> u64 {
        let p = Path::new(path);
        let Some(fname) = p.file_name().and_then(|s| s.to_str()) else {
            return 0;
        };
        let Some(base) = shard_base(fname) else {
            return std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        };
        let Some(dir) = p.parent() else { return 0 };
        let mut total = 0u64;
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                let ef = entry.file_name();
                if ef.to_str().and_then(shard_base) == Some(base) {
                    total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
                }
            }
        }
        total
    }

    fn is_draft_model_name(name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        lower.starts_with("mtp-") || lower.contains("-mtp.") || lower.contains("-mtp-")
    }

    fn mtp_rank(name: &str) -> u8 {
        let upper = name.to_ascii_uppercase();
        if upper.contains("Q8_0") {
            0
        } else if upper.contains("Q6") {
            1
        } else if upper.contains("Q5") {
            2
        } else if upper.contains("Q4") {
            3
        } else if upper.contains("BF16") || upper.contains("F16") {
            4
        } else {
            5
        }
    }

    fn collapse_shards(files: Vec<(String, u64)>) -> Vec<(String, u64)> {
        use std::collections::BTreeMap;
        let mut groups: BTreeMap<String, (String, u64)> = BTreeMap::new();
        let mut out: Vec<(String, u64)> = Vec::new();
        for (name, size) in files {
            if let Some(base) = shard_base(&name) {
                let e = groups
                    .entry(base.to_string())
                    .or_insert_with(|| (name.clone(), 0));
                e.1 += size;
                if name < e.0 {
                    e.0 = name.clone();
                }
            } else {
                out.push((name, size));
            }
        }
        out.extend(groups.into_values());
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    pub fn list_models() -> Result<Vec<String>, String> {
        let dir = models_dir();
        let mut raw = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("gguf") {
                    if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                        if is_draft_model_name(name) {
                            continue;
                        }
                        raw.push((name.to_string(), 0));
                    }
                }
            }
        }
        Ok(collapse_shards(raw).into_iter().map(|(n, _)| n).collect())
    }

    /// Same listing as `list_models` but with byte sizes (manager UI).
    pub fn models_info() -> Result<Vec<ModelInfo>, String> {
        let dir = models_dir();
        let mut raw = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("gguf") {
                    if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                        if is_draft_model_name(name) {
                            continue;
                        }
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        raw.push((name.to_string(), size));
                    }
                }
            }
        }
        Ok(collapse_shards(raw)
            .into_iter()
            .map(|(name, size)| ModelInfo { name, size })
            .collect())
    }

    /// Delete a model file. Guards against path traversal: `file` must be a bare
    /// `.gguf` basename living directly in the models dir.
    pub fn delete_model(file: String) -> Result<(), String> {
        if file.contains('/')
            || file.contains('\\')
            || file.contains("..")
            || !file.ends_with(".gguf")
        {
            return Err(format!("invalid model filename: {file}"));
        }
        let dir = models_dir();
        if let Some(base) = shard_base(&file) {
            let base = base.to_string();
            let mut errors = Vec::new();
            let mut removed = 0usize;
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for entry in rd.flatten() {
                    let fname = entry.file_name();
                    if fname.to_str().and_then(shard_base) == Some(base.as_str()) {
                        match std::fs::remove_file(entry.path()) {
                            Ok(()) => removed += 1,
                            Err(e) => errors.push(format!("{}: {e}", entry.path().display())),
                        }
                    }
                }
            }
            if !errors.is_empty() {
                return Err(format!("delete sharded model: {}", errors.join("; ")));
            }
            if removed == 0 {
                return Err(format!("no shards found for {file}"));
            }
            return Ok(());
        }
        std::fs::remove_file(dir.join(&file)).map_err(|e| format!("delete {file}: {e}"))
    }

    /// Start a download on a dedicated thread (HTTP I/O must not block the
    /// inference worker). Progress streams as `llm:download:{id}` events.
    pub fn download(
        app: AppHandle,
        state: State<'_, LlmManager>,
        args: LlmDownloadArgs,
    ) -> Result<(), String> {
        // Local filename = basename of the in-repo path. Subfolders are allowed in
        // the HF URL but never on disk; `.gguf` + no `..` is required.
        let local_name = Path::new(&args.path)
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("bad path: {}", args.path))?
            .to_string();
        if !local_name.ends_with(".gguf") || args.path.contains("..") {
            return Err(format!("invalid model path: {}", args.path));
        }
        let dir = models_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
        let dest = dir.join(&local_name);
        let part = dir.join(format!("{local_name}.part"));

        let cancel = Arc::new(AtomicBool::new(false));
        let downloads = state.downloads.clone();
        downloads
            .lock()
            .map_err(|_| "downloads lock poisoned")?
            .insert(args.id.clone(), cancel.clone());

        std::thread::Builder::new()
            .name("codezal-llm-dl".into())
            .spawn(move || {
                let ev = format!("llm:download:{}", args.id);
                let res = run_download(&app, &args, &dest, &part, &cancel);
                if let Ok(mut m) = downloads.lock() {
                    m.remove(&args.id);
                }
                match res {
                    Ok(true) => {
                        let _ = app.emit(&ev, serde_json::json!({ "kind": "done" }));
                    }
                    Ok(false) => {
                        let _ = app.emit(&ev, serde_json::json!({ "kind": "cancelled" }));
                    }
                    Err(e) => {
                        let _ = app.emit(&ev, serde_json::json!({ "kind": "error", "message": e }));
                    }
                }
            })
            .map_err(|e| format!("spawn download: {e}"))?;
        Ok(())
    }

    /// Blocking HTTP download with resume + cancel. Ok(true)=finished,
    /// Ok(false)=cancelled (partial `.part` kept so a retry resumes).
    fn run_download(
        app: &AppHandle,
        args: &LlmDownloadArgs,
        dest: &Path,
        part: &Path,
        cancel: &Arc<AtomicBool>,
    ) -> Result<bool, String> {
        use std::io::{Read, Write};
        let rev = args.revision.as_deref().unwrap_or("main");
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            args.repo, rev, args.path
        );
        // https-only — no plaintext binary fetch (prevents MITM → RCE).
        if !url.starts_with("https://") {
            return Err(format!("insecure download rejected, https required: {url}"));
        }

        // Resume from any existing `.part`.
        let existing: u64 = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        let mut req = ureq::get(&url);
        if existing > 0 {
            req = req.set("Range", &format!("bytes={existing}-"));
        }
        let resp = req.call().map_err(|e| format!("download start: {e}"))?;
        let status = resp.status();

        // 206 → server honored the range (append). Anything else → restart fresh.
        let (mut file, mut downloaded) = if status == 206 && existing > 0 {
            let f = std::fs::OpenOptions::new()
                .append(true)
                .open(part)
                .map_err(|e| format!("open part: {e}"))?;
            (f, existing)
        } else {
            let f = std::fs::File::create(part).map_err(|e| format!("create part: {e}"))?;
            (f, 0u64)
        };

        // Content-Length is the REMAINING length for a 206; add what we already have.
        let cl: u64 = resp
            .header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let total = if status == 206 { downloaded + cl } else { cl };

        let ev = format!("llm:download:{}", args.id);
        let mut reader = resp.into_reader();
        let mut buf = [0u8; 1 << 18]; // 256 KiB
        let mut last_emit = downloaded;
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush();
                return Ok(false);
            }
            let n = reader.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("write: {e}"))?;
            downloaded += n as u64;
            // Throttle progress to ~every 4 MiB (a 12 GB file → ~3k events).
            if downloaded - last_emit >= (4 << 20) {
                last_emit = downloaded;
                let _ = app.emit(
                    &ev,
                    serde_json::json!({ "kind": "progress", "downloaded": downloaded, "total": total }),
                );
            }
        }
        file.flush().map_err(|e| format!("flush: {e}"))?;
        drop(file);
        // Finalize: `.part` → final `.gguf` (only a complete file gets the real name).
        std::fs::rename(part, dest).map_err(|e| format!("finalize: {e}"))?;
        let _ = app.emit(
            &ev,
            serde_json::json!({ "kind": "progress", "downloaded": total, "total": total }),
        );
        Ok(true)
    }

    /// Spawn the worker once; it owns backend + model for the process lifetime.
    fn ensure_worker(app: AppHandle, state: &State<'_, LlmManager>) -> Result<Sender<Req>, String> {
        let mut guard = state.tx.lock().map_err(|_| "lock poisoned")?;
        if guard.is_none() {
            let (tx, rx) = channel::<Req>();
            let (init_tx, init_rx) = channel::<Result<(), String>>();
            std::thread::Builder::new()
                .name("codezal-llm".into())
                .spawn(move || worker_loop(app, rx, init_tx))
                .map_err(|e| format!("spawn worker: {e}"))?;
            // worker spawn edilmez.
            match init_rx.recv() {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(format!("llm backend init: {e}")),
                Err(_) => return Err("llm worker died during init".into()),
            }
            *guard = Some(tx);
        }
        Ok(guard.as_ref().unwrap().clone())
    }

    fn set_cancel(state: &State<'_, LlmManager>, gen_id: &str) -> Result<Arc<AtomicBool>, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        state
            .cancel
            .lock()
            .map_err(|_| "lock poisoned")?
            .insert(gen_id.to_string(), cancel.clone());
        Ok(cancel)
    }

    fn clear_cancel(cancel_map: &CancelMap, gen_id: &str) {
        if let Ok(mut map) = cancel_map.lock() {
            map.remove(gen_id);
        }
    }

    fn delta_has_tool_call(delta: &str) -> bool {
        serde_json::from_str::<serde_json::Value>(delta)
            .ok()
            .and_then(|v| v.get("tool_calls").map(|t| t.is_array()))
            .unwrap_or(false)
    }

    pub fn load(
        app: AppHandle,
        state: State<'_, LlmManager>,
        args: LlmLoadArgs,
    ) -> Result<(), String> {
        let tx = ensure_worker(app, &state)?;
        // this non-blocking if the UX needs it.
        let (reply_tx, reply_rx) = channel::<Result<(), String>>();
        tx.send(Req::Load {
            path: args.path,
            gpu_layers: args.gpu_layers.unwrap_or(999), // 999 → offload all layers
            n_ctx: args.n_ctx.unwrap_or(4096),
            reply: reply_tx,
        })
        .map_err(|_| "worker gone")?;
        reply_rx
            .recv()
            .map_err(|_| "worker dropped reply".to_string())?
    }

    pub fn generate(state: State<'_, LlmManager>, args: LlmGenArgs) -> Result<(), String> {
        let tx = {
            let guard = state.tx.lock().map_err(|_| "lock poisoned")?;
            guard
                .as_ref()
                .ok_or("no model loaded — call llm_load first")?
                .clone()
        };
        let gen_id = args.gen_id;
        let cancel = set_cancel(&state, &gen_id)?;
        let cancel_map = state.cancel.clone();
        if tx
            .send(Req::Generate {
                gen_id: gen_id.clone(),
                prompt: args.prompt,
                max_tokens: args.max_tokens.unwrap_or(256),
                cancel,
                cancel_map,
            })
            .is_err()
        {
            clear_cancel(&state.cancel, &gen_id);
            if let Ok(mut g) = state.tx.lock() {
                *g = None;
            }
            return Err("worker gone".into());
        }
        Ok(())
    }

    pub fn chat(
        app: AppHandle,
        state: State<'_, LlmManager>,
        args: LlmChatArgs,
    ) -> Result<(), String> {
        // Chat loads the requested model on demand, so it spawns the worker itself.
        let tx = ensure_worker(app, &state)?;
        let gen_id = args.gen_id;
        let cancel = set_cancel(&state, &gen_id)?;
        let cancel_map = state.cancel.clone();
        let flash_attn = flash_policy(args.flash_attention.as_deref().unwrap_or("enabled"));
        // Context window for the persistent session. 16384 default; up to 131072.
        // Large windows need KV quantization to fit — f16 KV for a 200k context is
        // 10-30 GB (RAM-bound on an 18 GB Mac); q8_0 halves it, q4_0 quarters it.
        let n_ctx = args.n_ctx.unwrap_or(32768).clamp(2048, 131072);
        let batch_size = resolve_batch_size(args.batch_size);
        let threads = resolve_threads(args.threads);
        let batch_threads = resolve_threads(args.batch_threads);
        let speculative = resolve_speculative(
            args.speculative_mode.as_deref(),
            args.draft_tokens,
            args.draft_model.as_deref(),
        )?;
        // KV cache type: an explicit override, else auto-pick the best-quality
        // type that still fits the chosen window (so a big window can't silently OOM).
        let kv_type = match args.kv_cache.as_deref() {
            Some(t @ ("f16" | "q8_0" | "q4_0")) => t.to_string(),
            _ => auto_kv_for_ctx(n_ctx), // "auto" or absent
        };
        if tx
            .send(Req::Chat {
                gen_id: gen_id.clone(),
                request: args.request,
                flash_attn,
                n_ctx,
                batch_size,
                threads,
                batch_threads,
                speculative,
                kv_type,
                cancel,
                cancel_map,
            })
            .is_err()
        {
            clear_cancel(&state.cancel, &gen_id);
            if let Ok(mut g) = state.tx.lock() {
                *g = None;
            }
            return Err("worker gone".into());
        }
        Ok(())
    }

    /// Map the `flash_attention` setting to llama.cpp's policy int
    /// (LLAMA_FLASH_ATTN_TYPE_*). Unknown/missing → enabled (our default): the
    /// llama.cpp AUTO default does not reliably turn FA on for a single Metal GPU,
    /// and FA shrinks the decode compute buffer (fixes tight-VRAM decode OOM).
    fn flash_policy(mode: &str) -> i32 {
        match mode {
            "disabled" => 0, // LLAMA_FLASH_ATTN_TYPE_DISABLED
            "auto" => -1,    // LLAMA_FLASH_ATTN_TYPE_AUTO
            _ => 1,          // LLAMA_FLASH_ATTN_TYPE_ENABLED
        }
    }

    fn auto_threads() -> i32 {
        std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(1).clamp(1, 12) as i32)
            .unwrap_or(4)
    }

    fn resolve_threads(value: Option<i32>) -> i32 {
        match value.unwrap_or(0) {
            n if n <= 0 => auto_threads(),
            n => n.clamp(1, 64),
        }
    }

    fn resolve_batch_size(value: Option<u32>) -> u32 {
        value.unwrap_or(2048).clamp(128, 4096)
    }

    fn resolve_speculative(
        mode: Option<&str>,
        draft_tokens: Option<u32>,
        draft_model: Option<&str>,
    ) -> Result<SpeculativeConfig, String> {
        let mode = match mode.unwrap_or("off") {
            "" | "off" => SpeculativeMode::Off,
            "mtp" => SpeculativeMode::Mtp,
            other => return Err(format!("unsupported speculative mode: {other}")),
        };
        let draft_model = draft_model
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        Ok(SpeculativeConfig {
            mode,
            draft_tokens: draft_tokens.unwrap_or(4).clamp(1, 16),
            draft_model,
        })
    }

    /// Map the KV-cache setting to a ggml type. Quantized KV (q8_0 = half, q4_0 =
    /// quarter the memory) lets much larger context windows fit; it needs flash
    /// attention (defaulted on). Unknown → f16.
    fn kv_cache_type(s: &str) -> KvCacheType {
        match s {
            "q8_0" => KvCacheType::Q8_0,
            "q4_0" => KvCacheType::Q4_0,
            _ => KvCacheType::F16,
        }
    }

    /// Auto-pick the KV cache type for a window: f16 ≤8k, q8_0 ≤64k, q4_0 beyond.
    /// q8_0 is near-lossless (flash attention is on by default) but halves KV vs
    /// f16, so chat-scale windows (8k–64k) fit a 7–12B model with far more room —
    /// f16 KV would OOM the Metal budget. Small windows keep f16 where memory is a
    /// non-issue and quality matters most. Used when the KV setting is "auto"; an
    /// explicit "f16"/"q8_0"/"q4_0" override always wins.
    fn auto_kv_for_ctx(n_ctx: u32) -> String {
        if n_ctx <= 8192 {
            "f16"
        } else if n_ctx <= 65536 {
            "q8_0"
        } else {
            "q4_0"
        }
        .to_string()
    }

    /// KV-cache bytes per element for a ggml type (K and V counted separately by
    /// the caller). q4_0 ≈ 18 B / 32 elem, q8_0 ≈ 34/32, f16 = 2 — llama.cpp block
    fn kv_elem_bytes(kv_type: &str) -> f64 {
        match kv_type {
            "q4_0" => 18.0 / 32.0, // 0.5625
            "q8_0" => 34.0 / 32.0, // 1.0625
            _ => 2.0,              // f16
        }
    }

    pub(crate) fn total_physical_ram() -> u64 {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        sys.total_memory() // sysinfo >= 0.30 → byte
    }

    /// KV-cache bytes for one (layer, token) slot = head_dim · n_head_kv · 2(K+V) ·
    /// elem_bytes. head_dim comes from the GGUF `<arch>.attention.key_length` when
    /// present (Gemma sets it independently of n_embd/n_head), else n_embd/n_head.
    fn kv_slot_bytes(model: &LlamaModel, kv_type: &str) -> f64 {
        let n_head = model.n_head().max(1) as u64;
        let head_dim = model
            .meta_val_str("general.architecture")
            .ok()
            .and_then(|arch| {
                model
                    .meta_val_str(&format!("{arch}.attention.key_length"))
                    .ok()
            })
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|d| *d > 0)
            .unwrap_or_else(|| (model.n_embd().max(1) as u64) / n_head);
        (head_dim * model.n_head_kv().max(1) as u64 * 2) as f64 * kv_elem_bytes(kv_type)
    }

    /// SWA-aware count of (layer × token) KV slots for a context window. Sliding-
    /// window models (Gemma 3/4) cap most layers at `sliding_window` tokens no matter
    /// how large the context is, so only the periodic global-attention layers pay the
    /// full window. Full-attention models lack the SWA metadata → every layer holds
    /// the full window (identical to the old n_layer · n_ctx estimate).
    fn kv_layer_token_slots(model: &LlamaModel, n_ctx: u32) -> u64 {
        let n_layer = model.n_layer().max(1) as u64;
        let n_ctx = n_ctx as u64;
        let full = n_layer * n_ctx;
        let Ok(arch) = model.meta_val_str("general.architecture") else {
            return full;
        };
        let swa_window = model
            .meta_val_str(&format!("{arch}.attention.sliding_window"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|w| *w > 0);
        let Some(swa_window) = swa_window else {
            return full; // no sliding window → full attention on every layer
        };
        // sliding_window_pattern = P → one global (full-window) layer per P layers
        // (Gemma uses 6, i.e. 5 local : 1 global). Absent → assume Gemma's 6.
        let pattern = model
            .meta_val_str(&format!("{arch}.attention.sliding_window_pattern"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|p| *p >= 1)
            .unwrap_or(6);
        let global_layers = (n_layer / pattern).max(1);
        let swa_layers = n_layer.saturating_sub(global_layers);
        global_layers * n_ctx + swa_layers * n_ctx.min(swa_window)
    }

    /// Total KV-cache bytes for a context window (SWA-aware). Used by the mem-safe
    /// clamp and the advisor breakdown so both reflect real sliding-window cost.
    fn kv_bytes_for_ctx(model: &LlamaModel, n_ctx: u32, kv_type: &str) -> u64 {
        (kv_layer_token_slots(model, n_ctx) as f64 * kv_slot_bytes(model, kv_type)) as u64
    }

    const LLM_COMPUTE_RESERVE: u64 = 1024 * 1024 * 1024;

    fn ram_budget(total_ram: u64) -> u64 {
        const RESERVE_CAP: u64 = 8 * 1024 * 1024 * 1024;
        let frac = (total_ram as f64 * 0.62) as u64;
        frac.max(total_ram.saturating_sub(RESERVE_CAP))
    }

    /// Memory-safe context window: weights + KV + compute reserve must stay within
    /// the physical-RAM budget, else a big model + big window (12B Q6_K ~10 GB +
    /// 131072 KV ~7 GB) pushes an 18 GB Mac into swap and freezes the system. The
    /// window is only ever clamped DOWN (never up); untouched if RAM can't be read.
    ///
    /// KV cost is SWA-aware (see `kv_layer_token_slots`), so for sliding-window
    /// models (Gemma) it is no longer linear in n_ctx — the local layers saturate at
    /// the window. We therefore binary-search the largest fitting window instead of
    /// dividing the budget by a fixed per-token cost.
    fn mem_safe_n_ctx(model: &LlamaModel, requested: u32, kv_type: &str) -> u32 {
        let total_ram = total_physical_ram();
        if total_ram == 0 {
            return requested; // can't detect → don't touch the user's choice
        }
        // Budget = max(62% of RAM, RAM − 8 GB), leaving room for app + OS + compute.
        // NOTE: macOS sysinfo available_memory reads misleadingly low (it omits
        // reclaimable file cache → ~3 GB on an 18 GB Mac), so we use the physical
        // total with a conservative fraction instead.
        let budget = ram_budget(total_ram);
        let kv_budget = budget
            .saturating_sub(model.size())
            .saturating_sub(LLM_COMPUTE_RESERVE);
        if kv_bytes_for_ctx(model, requested, kv_type) <= kv_budget {
            return requested; // already fits — common case for SWA models
        }
        // Largest 512-aligned window (≥512) whose SWA-aware KV fits the budget. A
        // small window beats a freeze when memory is tight.
        let (mut lo, mut hi) = (512u32, requested);
        while lo + 512 < hi {
            let mid = lo + (hi - lo) / 2;
            if kv_bytes_for_ctx(model, mid, kv_type) <= kv_budget {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        ((lo / 512) * 512).max(512)
    }

    #[allow(clippy::too_many_arguments)]
    fn ensure_draft_session(
        backend: &'static LlamaBackend,
        target_model: &LlamaModel,
        draft_models: &mut HashMap<String, &'static LlamaModel>,
        draft_session: &mut Option<DraftSession>,
        target_path: &str,
        speculative: &SpeculativeConfig,
        n_ctx: u32,
        flash_attn: i32,
        batch_size: u32,
        threads: i32,
        batch_threads: i32,
        _kv_type: &str,
    ) -> Result<bool, String> {
        if !matches!(speculative.mode, SpeculativeMode::Mtp) {
            *draft_session = None;
            return Ok(false);
        }
        let draft_path = resolve_mtp_draft_path(target_path, speculative.draft_model.as_deref())?;
        if draft_path == target_path {
            return Err("MTP draft model must differ from the target model".into());
        }
        if !draft_models.contains_key(&draft_path) {
            let total_ram = total_physical_ram();
            let draft_weights = model_total_size(&draft_path);
            if total_ram > 0 && draft_weights > 0 {
                let budget = ram_budget(total_ram);
                let total = target_model
                    .size()
                    .saturating_add(draft_weights)
                    .saturating_add(LLM_COMPUTE_RESERVE * 2);
                if total > budget {
                    return Err(format!(
                        "MTP draft model does not fit safely: target+draft ~{:.1} GB, safe budget ~{:.1} GB",
                        total as f64 / 1e9,
                        budget as f64 / 1e9,
                    ));
                }
            }
        }
        evict_draft_models(draft_models, draft_session, &draft_path);
        let draft_model = get_model(backend, draft_models, &draft_path, 999)?;
        if draft_model.n_vocab() != target_model.n_vocab()
            || draft_model.vocab_type() != target_model.vocab_type()
        {
            return Err("MTP draft model vocab is not compatible with target model".into());
        }
        let need_new = draft_session
            .as_ref()
            .map(|s| {
                let draft_n_ctx = n_ctx.min(draft_model.n_ctx_train().max(2048)).max(2048);
                s.path != draft_path
                    || s.n_ctx != draft_n_ctx
                    || s.flash_attn != flash_attn
                    || s.batch_size != batch_size
                    || s.threads != threads
                    || s.batch_threads != batch_threads
                    || s.kv_type != "f16"
            })
            .unwrap_or(true);
        if need_new {
            let n_ubatch = batch_size.min(512).max(128);
            let draft_n_ctx = n_ctx.min(draft_model.n_ctx_train().max(2048)).max(2048);
            let mut ctx_params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(draft_n_ctx))
                .with_n_batch(batch_size)
                .with_n_ubatch(n_ubatch)
                .with_n_threads(threads)
                .with_n_threads_batch(batch_threads)
                .with_flash_attention_policy(flash_attn)
                .with_type_k(kv_cache_type("f16"))
                .with_type_v(kv_cache_type("f16"));
            let n_train = draft_model.n_ctx_train();
            if draft_n_ctx > n_train {
                ctx_params = ctx_params
                    .with_rope_scaling_type(RopeScalingType::Yarn)
                    .with_yarn_orig_ctx(n_train)
                    .with_rope_freq_scale(n_train as f32 / draft_n_ctx as f32);
            }
            let ctx = draft_model
                .new_context(backend, ctx_params)
                .map_err(|e| format!("new draft context: {e}"))?;
            *draft_session = Some(DraftSession {
                path: draft_path,
                ctx,
                cached: Vec::new(),
                n_ctx: draft_n_ctx,
                flash_attn,
                batch_size,
                threads,
                batch_threads,
                kv_type: "f16".to_string(),
            });
        }
        Ok(true)
    }

    fn worker_loop(app: AppHandle, rx: Receiver<Req>, init: Sender<Result<(), String>>) {
        // Leak the backend so chat contexts can be 'static (kept warm across turns).
        let backend: &'static LlamaBackend = match LlamaBackend::init() {
            Ok(b) => {
                let _ = init.send(Ok(()));
                Box::leak(Box::new(b))
            }
            Err(e) => {
                log::error!("llama backend init failed: {e}");
                let _ = init.send(Err(e.to_string()));
                return;
            }
        };
        let mut models: HashMap<String, &'static LlamaModel> = HashMap::new();
        let mut draft_models: HashMap<String, &'static LlamaModel> = HashMap::new();
        // Persistent chat context (warm KV reused across turns).
        let mut session: Option<ChatSession> = None;
        let mut draft_session: Option<DraftSession> = None;
        // Model for the dev-panel raw-generate path (llm_load + llm_generate_stream).
        let mut gen_model: Option<&'static LlamaModel> = None;

        while let Ok(req) = rx.recv() {
            match req {
                Req::Load {
                    path,
                    gpu_layers,
                    n_ctx: _,
                    reply,
                } => match get_model(backend, &mut models, &path, gpu_layers) {
                    Ok(m) => {
                        gen_model = Some(m);
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                },
                Req::Generate {
                    gen_id,
                    prompt,
                    max_tokens,
                    cancel,
                    cancel_map,
                } => {
                    let Some(m) = gen_model else {
                        let _ = app.emit(
                            &format!("llm:error:{gen_id}"),
                            ErrorPayload {
                                message: "no model loaded".into(),
                            },
                        );
                        clear_cancel(&cancel_map, &gen_id);
                        continue;
                    };
                    if cancel.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            &format!("llm:done:{gen_id}"),
                            DonePayload {
                                tokens: 0,
                                cancelled: true,
                                tokens_per_sec: 0.0,
                            },
                        );
                        clear_cancel(&cancel_map, &gen_id);
                        continue;
                    }
                    // Dev panel uses a fresh context (raw prompt, no KV reuse).
                    match generate_loop(backend, m, 4096, &prompt, max_tokens, &cancel, |piece| {
                        let _ = app.emit(
                            &format!("llm:token:{gen_id}"),
                            TokenPayload {
                                text: piece.to_string(),
                            },
                        );
                    }) {
                        Ok((produced, stop, tps)) => {
                            log::info!("⚡ local gen: {tps:.1} tok/s ({produced} tokens)");
                            let _ = app.emit(
                                &format!("llm:done:{gen_id}"),
                                DonePayload {
                                    tokens: produced,
                                    cancelled: matches!(stop, StopReason::Cancelled),
                                    tokens_per_sec: tps,
                                },
                            );
                        }
                        Err(e) => {
                            let _ = app
                                .emit(&format!("llm:error:{gen_id}"), ErrorPayload { message: e });
                        }
                    }
                    clear_cancel(&cancel_map, &gen_id);
                }
                Req::Chat {
                    gen_id,
                    request,
                    flash_attn,
                    n_ctx,
                    batch_size,
                    threads,
                    batch_threads,
                    speculative,
                    kv_type,
                    cancel,
                    cancel_map,
                } => {
                    if cancel.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            &format!("llm:chat:{gen_id}"),
                            ChatEvent::Done {
                                finish_reason: "stop".into(),
                                tokens_per_sec: 0.0,
                                tokens: 0,
                                ttft_ms: 0,
                            },
                        );
                        clear_cancel(&cancel_map, &gen_id);
                        continue;
                    }
                    if let Err(e) = chat_turn(
                        &app,
                        backend,
                        &mut models,
                        &mut session,
                        &gen_id,
                        &request,
                        flash_attn,
                        n_ctx,
                        batch_size,
                        threads,
                        batch_threads,
                        &kv_type,
                        &mut gen_model,
                        &cancel,
                        speculative,
                        &mut draft_models,
                        &mut draft_session,
                    ) {
                        let _ = app.emit(
                            &format!("llm:chat:{gen_id}"),
                            ChatEvent::Error { message: e },
                        );
                    }
                    clear_cancel(&cancel_map, &gen_id);
                }
            }
        }
    }

    // prompt via the model's chat template, reuses the KV of the longest common
    // prefix already in the cache, prefills ONLY the new suffix, then streams the
    // completion. Local runs tool-free (single-turn chat), so content is emitted
    // directly as OpenAI content deltas.
    /// Sibling multimodal projector for a model: `<dir>/mmproj-<modelfile>`. None
    /// when absent → the model is treated as text-only.
    fn mmproj_path_for(model_path: &str) -> Option<String> {
        let p = Path::new(model_path);
        let name = p.file_name()?.to_str()?;
        let cand = p.with_file_name(format!("mmproj-{name}"));
        cand.exists().then(|| cand.to_string_lossy().into_owned())
    }

    /// Sibling MTP draft model for a target model. llama.cpp accepts draft GGUFs
    /// next to the primary model; repos commonly name them either `mtp-*` or
    /// `*-MTP-*` and may publish them under an `MTP/` folder.
    fn mtp_path_for(model_path: &str) -> Option<String> {
        let p = Path::new(model_path);
        let name = p.file_name()?.to_str()?;
        let exact = p.with_file_name(format!("mtp-{name}"));
        if exact.exists() {
            return Some(exact.to_string_lossy().into_owned());
        }
        let dir = p.parent()?;
        let mut hits = Vec::new();
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                let ep = entry.path();
                let Some(fname) = ep.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                if is_draft_model_name(fname) && fname.ends_with(".gguf") {
                    hits.push(ep);
                }
            }
        }
        hits.sort_by(|a, b| {
            let an = a.file_name().and_then(|s| s.to_str()).unwrap_or_default();
            let bn = b.file_name().and_then(|s| s.to_str()).unwrap_or_default();
            mtp_rank(an).cmp(&mtp_rank(bn)).then_with(|| a.cmp(b))
        });
        hits.first().map(|p| p.to_string_lossy().into_owned())
    }

    fn resolve_mtp_draft_path(model_path: &str, explicit: Option<&str>) -> Result<String, String> {
        if let Some(draft) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
            let path = resolve_model_path(draft);
            if Path::new(&path).exists() {
                return Ok(path);
            }
            return Err(format!("MTP draft model not found: {path}"));
        }
        mtp_path_for(model_path).ok_or_else(|| {
            "MTP draft model not found: install an MTP GGUF next to the target model or set draftModel"
                .to_string()
        })
    }

    /// Decode an OpenAI `data:image/...;base64,XXXX` URL (or a bare base64 string) to
    /// bytes. Remote http(s) URLs are rejected — the inference worker does no network
    /// I/O; the caller embeds images as data URLs.
    fn decode_image_url(url: &str) -> Result<Vec<u8>, String> {
        if url.starts_with("http://") || url.starts_with("https://") {
            return Err(
                "remote image URLs are not supported for local vision — embed the image as a data: URL"
                    .into(),
            );
        }
        // "data:<mime>;base64,<DATA>" → take what follows the last comma; tolerate a
        // bare base64 payload with no data-URL prefix.
        let b64 = url.rsplit_once(',').map(|(_, d)| d).unwrap_or(url);
        base64::engine::general_purpose::STANDARD
            .decode(b64.trim().as_bytes())
            .map_err(|e| format!("image base64 decode: {e}"))
    }

    /// Pull base64 images out of OpenAI multimodal `content` arrays and rewrite each
    /// message's content to a plain string, inserting `marker` where each image was so
    /// the renderer and the mtmd tokenizer agree on image positions. Returns the
    /// rewritten messages JSON and the decoded image buffers in request order. No
    /// images → the JSON is returned unchanged and the vec is empty, so the text path
    /// stays bit-for-bit identical.
    fn extract_images(messages_json: &str, marker: &str) -> Result<(String, Vec<Vec<u8>>), String> {
        let mut root: serde_json::Value =
            serde_json::from_str(messages_json).map_err(|e| format!("messages json: {e}"))?;
        let mut images: Vec<Vec<u8>> = Vec::new();
        let Some(msgs) = root.as_array_mut() else {
            return Ok((messages_json.to_string(), images));
        };
        for msg in msgs.iter_mut() {
            let Some(content) = msg.get_mut("content") else {
                continue;
            };
            // String content (the common case) is left untouched; only array content
            // can carry image parts.
            let Some(parts) = content.as_array().cloned() else {
                continue;
            };
            let mut text = String::new();
            for part in &parts {
                match part.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                    Some("image_url") => {
                        let url = part
                            .get("image_url")
                            .and_then(|u| u.get("url"))
                            .and_then(|u| u.as_str())
                            .unwrap_or_default();
                        images.push(decode_image_url(url)?);
                        text.push_str(marker);
                    }
                    _ => {}
                }
            }
            *content = serde_json::Value::String(text);
        }
        let rewritten =
            serde_json::to_string(&root).map_err(|e| format!("messages reserialize: {e}"))?;
        Ok((rewritten, images))
    }

    #[allow(clippy::too_many_arguments)]
    fn chat_turn(
        app: &AppHandle,
        backend: &'static LlamaBackend,
        models: &mut HashMap<String, &'static LlamaModel>,
        session: &mut Option<ChatSession>,
        gen_id: &str,
        request: &str,
        flash_attn: i32,
        n_ctx: u32,
        batch_size: u32,
        threads: i32,
        batch_threads: i32,
        kv_type: &str,
        gen_model: &mut Option<&'static LlamaModel>,
        cancel: &Arc<AtomicBool>,
        speculative: SpeculativeConfig,
        draft_models: &mut HashMap<String, &'static LlamaModel>,
        draft_session: &mut Option<DraftSession>,
    ) -> Result<(), String> {
        let req: serde_json::Value =
            serde_json::from_str(request).map_err(|e| format!("bad request json: {e}"))?;
        let model_ref = req
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if model_ref.is_empty() {
            return Err("request.model is required".into());
        }
        let messages_json = req
            .get("messages")
            .map(|m| m.to_string())
            .ok_or("request.messages is required")?;
        let max_tokens = req
            .get("max_tokens")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(1024)
            .clamp(1, 2048);
        // Tools (optional): when the request carries tools, render them into the
        // template and parse tool calls back out of the stream.
        let tools_json: Option<String> = req
            .get("tools")
            .filter(|t| t.as_array().map(|a| !a.is_empty()).unwrap_or(false))
            .map(|t| t.to_string());
        let path = resolve_model_path(model_ref);

        if !models.contains_key(&path) {
            let weights = model_total_size(&path);
            let total_ram = total_physical_ram();
            if weights > 0 && total_ram > 0 {
                let budget = ram_budget(total_ram);
                if weights.saturating_add(LLM_COMPUTE_RESERVE) > budget {
                    return Err(format!(
                        "Model bu makineye sığmıyor: ağırlıklar ~{:.1} GB, güvenli bütçe ~{:.1} GB ({:.0} GB RAM'in ~%{:.0}'si). Sistem donmasını önlemek için yükleme durduruldu — daha küçük bir model ya da daha düşük quant seç.",
                        weights as f64 / 1e9,
                        budget as f64 / 1e9,
                        total_ram as f64 / 1e9,
                        budget as f64 / total_ram as f64 * 100.0,
                    ));
                }
            }
        }

        // Free any OTHER resident model before (re)loading this one — two large GGUFs
        // can't coexist in the Metal budget (decode OOM on tight-VRAM Macs). Runs AFTER
        // the fit guard so we never evict a working model just to then reject the new one.
        evict_other_models(models, session, gen_model, &path);

        let model = get_model(backend, models, &path, 999)?;
        let requested_n_ctx = n_ctx;
        let n_ctx = mem_safe_n_ctx(model, n_ctx, kv_type);

        // (Re)create the session when the model, the context window, or the
        // flash-attention policy changes (or none exists yet). The window is
        // fixed for the session's life — KV reuse needs a stable size.
        let need_new = session
            .as_ref()
            .map(|s| {
                s.path != path
                    || s.n_ctx != n_ctx
                    || s.flash_attn != flash_attn
                    || s.batch_size != batch_size
                    || s.threads != threads
                    || s.batch_threads != batch_threads
                    || s.kv_type != kv_type
            })
            .unwrap_or(true);
        if need_new {
            if n_ctx < requested_n_ctx {
                log::warn!(
                    "context {requested_n_ctx} → {n_ctx} (bellek-güvenli: model {:.1} GB)",
                    model.size() as f64 / 1e9
                );
                let _ = app.emit(
                    &format!("llm:chat:{gen_id}"),
                    ChatEvent::Notice {
                        requested: requested_n_ctx,
                        effective: n_ctx,
                        model: model_ref.to_string(),
                        model_gb: model.size() as f64 / 1e9,
                    },
                );
            }
            let _ = app.emit(
                &format!("llm:chat:{gen_id}"),
                ChatEvent::ModelInfo {
                    requested_ctx: requested_n_ctx,
                    effective_ctx: n_ctx,
                    n_train: model.n_ctx_train(),
                    weights: model.size(),
                    kv: kv_bytes_for_ctx(model, n_ctx, kv_type),
                    compute: LLM_COMPUTE_RESERVE,
                    ram: total_physical_ram(),
                },
            );
            let n_ubatch = batch_size.min(512).max(128);
            let mut ctx_params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(n_ctx))
                .with_n_batch(batch_size)
                .with_n_ubatch(n_ubatch)
                .with_n_threads(threads)
                .with_n_threads_batch(batch_threads)
                .with_flash_attention_policy(flash_attn)
                .with_type_k(kv_cache_type(kv_type))
                .with_type_v(kv_cache_type(kv_type));
            // ekstrapolasyonu kaliteyi bozar ("possible training context overflow").
            let n_train = model.n_ctx_train();
            if n_ctx > n_train {
                ctx_params = ctx_params
                    .with_rope_scaling_type(RopeScalingType::Yarn)
                    .with_yarn_orig_ctx(n_train)
                    .with_rope_freq_scale(n_train as f32 / n_ctx as f32);
                log::info!(
                    "🧶 YaRN aktif: n_ctx={n_ctx} > train={n_train} (faktör {:.2})",
                    n_ctx as f32 / n_train as f32
                );
            }
            let ctx = model
                .new_context(backend, ctx_params)
                .map_err(|e| format!("new_context: {e}"))?;
            *session = Some(ChatSession {
                path: path.clone(),
                ctx,
                cached: Vec::new(),
                n_ctx,
                flash_attn,
                batch_size,
                threads,
                batch_threads,
                kv_type: kv_type.to_string(),
            });
        }
        let model = *models.get(&path).ok_or("model vanished")?;
        let session = session.as_mut().unwrap();

        // independent). Verified byte-identical to apply_chat_template_oaicompat
        // by examples/chat_render_check across the Qwen + Gemma template families.
        let template_str = model
            .chat_template(None)
            .map_err(|e| format!("chat_template: {e}"))?
            .to_string()
            .map_err(|e| format!("chat_template utf8: {e}"))?;
        // Vision: pull base64 images out of the OpenAI multimodal content arrays and
        // swap each for an mtmd media marker. No images → JSON unchanged, so the text
        // path below stays bit-for-bit identical.
        let marker = mtmd_default_marker();
        let (render_messages, images) = extract_images(&messages_json, marker)?;
        let prompt = crate::chat_render::render_prompt(
            &template_str,
            &render_messages,
            tools_json.as_deref(),
            true,
        )?;

        let turn_start = std::time::Instant::now();
        let reused: usize;
        let last_logit_idx: i32;
        let n_cur_start: i32;
        let mut speculative_active = false;
        let mut draft_sample_idx = 0i32;

        if images.is_empty() {
            // ── Text prefill: KV-reuse path ───────────────────────────────────────
            let tokens = model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| format!("tokenize: {e}"))?;
            if tokens.is_empty() {
                return Err("prompt tokenized to zero tokens".into());
            }
            // If the conversation outgrew the fixed window, reset the session and report.
            if tokens.len() + 8 >= session.n_ctx as usize {
                session.ctx.clear_kv_cache();
                session.cached.clear();
                return Err(format!(
                    "conversation is {} tokens — too long for the local context window ({})",
                    tokens.len(),
                    session.n_ctx
                ));
            }
            // KV REUSE: keep the longest common prefix already in the cache; re-decode
            // at least the final prompt token to get fresh logits.
            let mut common = 0usize;
            while common < session.cached.len()
                && common < tokens.len()
                && session.cached[common] == tokens[common]
            {
                common += 1;
            }
            let common = common.min(tokens.len() - 1);
            // Drop the divergent KV tail (positions >= common); keep the shared prefix.
            session
                .ctx
                .clear_kv_cache_seq(Some(0), Some(common as u32), None)
                .map_err(|e| format!("kv trim: {e}"))?;

            let prefill_batch_size = session.batch_size as usize;
            last_logit_idx = match prefill(session, &tokens, common, prefill_batch_size) {
                Ok(idx) => idx,
                Err(_) if common > 0 => {
                    session.ctx.clear_kv_cache();
                    session.cached.clear();
                    prefill(session, &tokens, 0, prefill_batch_size)?
                }
                Err(e) => return Err(e),
            };
            reused = common;
            n_cur_start = tokens.len() as i32;
            // The KV now holds the full prompt; generation appends to KV + cached.
            session.cached = tokens.clone();
            speculative_active = match ensure_draft_session(
                backend,
                model,
                draft_models,
                draft_session,
                &path,
                &speculative,
                n_ctx,
                flash_attn,
                batch_size,
                threads,
                batch_threads,
                kv_type,
            ) {
                Ok(active) => active,
                Err(e) => {
                    log::warn!("MTP disabled for this turn: {e}");
                    *draft_session = None;
                    false
                }
            };
            if speculative_active {
                if let Some(draft) = draft_session.as_mut() {
                    let needed = session
                        .cached
                        .len()
                        .saturating_add(speculative.draft_tokens as usize)
                        .saturating_add(1);
                    if needed >= draft.n_ctx as usize {
                        log::warn!(
                            "MTP disabled for this turn: prompt {} tokens exceeds draft context {}",
                            session.cached.len(),
                            draft.n_ctx
                        );
                        speculative_active = false;
                    } else {
                        match sync_draft_to_tokens(draft, &session.cached) {
                            Ok(idx) => draft_sample_idx = idx,
                            Err(e) => {
                                log::warn!("MTP disabled for this turn: {e}");
                                speculative_active = false;
                            }
                        }
                    }
                } else {
                    speculative_active = false;
                }
            }
        } else {
            if matches!(speculative.mode, SpeculativeMode::Mtp) {
                return Err(
                    "MTP speculative decoding is not supported for local vision prompts".into(),
                );
            }
            // ── Vision prefill (mtmd): interleaved text + image chunks, no reuse ───
            let mmproj = mmproj_path_for(&path).ok_or_else(|| {
                "this model has no vision projector (an mmproj-*.gguf next to it) — \
                 download the model's mmproj file to send images"
                    .to_string()
            })?;
            let mut mparams = MtmdContextParams::default();
            mparams.use_gpu = true;
            let mtmd = MtmdContext::init_from_file(&mmproj, model, &mparams)
                .map_err(|e| format!("mtmd init ({mmproj}): {e:?}"))?;
            if !mtmd.support_vision() {
                return Err(
                    "the multimodal projector for this model does not support images".into(),
                );
            }
            let bitmaps: Vec<MtmdBitmap> = images
                .iter()
                .map(|b| MtmdBitmap::from_buffer(&mtmd, b, false))
                .collect::<Result<_, _>>()
                .map_err(|e| format!("image decode: {e:?}"))?;
            let refs: Vec<&MtmdBitmap> = bitmaps.iter().collect();
            let chunks = mtmd
                .tokenize(
                    MtmdInputText {
                        text: prompt,
                        add_special: true,
                        parse_special: true,
                    },
                    &refs,
                )
                .map_err(|e| format!("mtmd tokenize: {e:?}"))?;
            let positions = chunks.total_positions();
            if positions < 0 || positions as u32 + 8 >= session.n_ctx {
                session.ctx.clear_kv_cache();
                session.cached.clear();
                return Err(format!(
                    "image prompt is {positions} positions — too long for the local context window ({})",
                    session.n_ctx
                ));
            }
            // Image embeddings break token-id prefix reuse → always prefill fresh.
            session.ctx.clear_kv_cache();
            session.cached.clear();
            let n_batch = session.ctx.n_batch() as i32;
            // eval_chunks runs llama_decode on text and mtmd_encode+decode on images,
            // leaving the full multimodal prompt in the KV cache; mtmd is then dropped
            // (generation is pure text autoregression from here).
            let new_n_past = chunks
                .eval_chunks(&mtmd, &session.ctx, 0, 0, n_batch, true)
                .map_err(|e| format!("mtmd eval: {e:?}"))?;
            reused = 0;
            last_logit_idx = -1; // sample from the last decoded position
            n_cur_start = new_n_past;
        }

        let mut batch = LlamaBatch::new(512, 1);

        // <tool_call> blocks and strip <think>, emitting the same OpenAI delta
        // shape the JS bridge frames. Replaces streaming_state_oaicompat.
        let mut parser = crate::chat_parse::ChatStreamParser::new();
        let mut saw_tool_call = false;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::temp(0.8),
            LlamaSampler::dist(1234),
        ]);
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut sample_idx = last_logit_idx;
        let mut n_cur = n_cur_start;
        let mut produced = 0usize;
        let mut ttft_ms = 0u64;

        let gen_start = std::time::Instant::now();
        let mut finish = loop {
            if cancel.load(Ordering::Relaxed) {
                break "stop";
            }
            if produced >= max_tokens || (n_cur as u32) >= session.n_ctx {
                break "length";
            }
            if speculative_active {
                let remaining = max_tokens
                    .saturating_sub(produced)
                    .min(session.n_ctx.saturating_sub(n_cur as u32) as usize);
                let draft_limit = (speculative.draft_tokens as usize).min(remaining);
                let draft = if draft_limit > 0 {
                    draft_propose(
                        draft_session.as_mut().ok_or("draft session missing")?,
                        draft_sample_idx,
                        n_cur,
                        draft_limit,
                        cancel,
                    )?
                } else {
                    Vec::new()
                };
                if !draft.is_empty() {
                    let prefix_pos = n_cur;
                    let prefix_len = session.cached.len();
                    batch.clear();
                    for (i, token) in draft.iter().enumerate() {
                        batch
                            .add(*token, prefix_pos + i as i32, &[0], true)
                            .map_err(|e| format!("batch.add speculative: {e}"))?;
                    }
                    session.decode_or_reset(&mut batch)?;

                    let mut accepted = 0usize;
                    let mut rejected = false;
                    let mut stop_after_spec = false;
                    for (i, draft_token) in draft.iter().enumerate() {
                        let row = if i == 0 { sample_idx } else { (i - 1) as i32 };
                        let target = sampler.sample(&session.ctx, row);
                        if model.is_eog_token(target) {
                            let keep = prefix_pos + accepted as i32;
                            session
                                .ctx
                                .clear_kv_cache_seq(Some(0), Some(keep as u32), None)
                                .map_err(|e| format!("kv trim speculative stop: {e}"))?;
                            session.cached.truncate(prefix_len + accepted);
                            stop_after_spec = true;
                            break;
                        }
                        if target == *draft_token {
                            sampler.accept(target);
                            let piece = model
                                .token_to_piece(target, &mut decoder, false, None)
                                .unwrap_or_default();
                            for d in parser.push(&piece) {
                                if delta_has_tool_call(&d) {
                                    saw_tool_call = true;
                                }
                                let _ = app.emit(
                                    &format!("llm:chat:{gen_id}"),
                                    ChatEvent::OaiDelta { json: d },
                                );
                            }
                            session.cached.push(target);
                            produced += 1;
                            accepted += 1;
                            n_cur += 1;
                            if produced == 1 {
                                ttft_ms = turn_start.elapsed().as_millis() as u64;
                            }
                            if produced >= max_tokens || (n_cur as u32) >= session.n_ctx {
                                break;
                            }
                            continue;
                        }

                        rejected = true;
                        sampler.accept(target);
                        let keep = prefix_pos + accepted as i32;
                        session
                            .ctx
                            .clear_kv_cache_seq(Some(0), Some(keep as u32), None)
                            .map_err(|e| format!("kv trim speculative reject: {e}"))?;
                        session.cached.truncate(prefix_len + accepted);
                        batch.clear();
                        batch
                            .add(target, keep, &[0], true)
                            .map_err(|e| format!("batch.add fallback: {e}"))?;
                        session.decode_or_reset(&mut batch)?;
                        sample_idx = 0;
                        n_cur = keep + 1;
                        let piece = model
                            .token_to_piece(target, &mut decoder, false, None)
                            .unwrap_or_default();
                        for d in parser.push(&piece) {
                            if delta_has_tool_call(&d) {
                                saw_tool_call = true;
                            }
                            let _ = app.emit(
                                &format!("llm:chat:{gen_id}"),
                                ChatEvent::OaiDelta { json: d },
                            );
                        }
                        session.cached.push(target);
                        produced += 1;
                        if produced == 1 {
                            ttft_ms = turn_start.elapsed().as_millis() as u64;
                        }
                        draft_sample_idx = sync_draft_to_tokens(
                            draft_session.as_mut().ok_or("draft session missing")?,
                            &session.cached,
                        )?;
                        break;
                    }
                    if stop_after_spec {
                        break "stop";
                    }
                    if !rejected && accepted < draft.len() {
                        let keep = prefix_pos + accepted as i32;
                        session
                            .ctx
                            .clear_kv_cache_seq(Some(0), Some(keep as u32), None)
                            .map_err(|e| format!("kv trim speculative limit: {e}"))?;
                        session.cached.truncate(prefix_len + accepted);
                        draft_sample_idx = sync_draft_to_tokens(
                            draft_session.as_mut().ok_or("draft session missing")?,
                            &session.cached,
                        )?;
                    } else if !rejected && accepted == draft.len() {
                        sample_idx = (draft.len() - 1) as i32;
                        draft_sample_idx = 0;
                    }
                    continue;
                }
            }
            let next = sampler.sample(&session.ctx, sample_idx);
            sampler.accept(next);
            if model.is_eog_token(next) {
                break "stop";
            }
            let piece = model
                .token_to_piece(next, &mut decoder, false, None)
                .unwrap_or_default();
            for d in parser.push(&piece) {
                if delta_has_tool_call(&d) {
                    saw_tool_call = true;
                }
                let _ = app.emit(
                    &format!("llm:chat:{gen_id}"),
                    ChatEvent::OaiDelta { json: d },
                );
            }
            session.cached.push(next);
            produced += 1;
            if produced == 1 {
                ttft_ms = turn_start.elapsed().as_millis() as u64;
            }

            batch.clear();
            batch
                .add(next, n_cur, &[0], true)
                .map_err(|e| format!("batch.add: {e}"))?;
            n_cur += 1;
            sample_idx = 0;
            session.decode_or_reset(&mut batch)?;
        };
        // Flush — emit any buffered trailing content / unterminated block.
        for d in parser.flush() {
            if delta_has_tool_call(&d) {
                saw_tool_call = true;
            }
            let _ = app.emit(
                &format!("llm:chat:{gen_id}"),
                ChatEvent::OaiDelta { json: d },
            );
        }
        if saw_tool_call {
            finish = "tool_calls";
        }
        let secs = gen_start.elapsed().as_secs_f64();
        let tps = if secs > 0.0 {
            produced as f64 / secs
        } else {
            0.0
        };
        log::info!("⚡ local gen: {tps:.1} tok/s ({produced} tok, reused {reused} prefix)");
        let _ = app.emit(
            &format!("llm:chat:{gen_id}"),
            ChatEvent::Done {
                finish_reason: finish.to_string(),
                tokens_per_sec: tps,
                tokens: produced,
                ttft_ms,
            },
        );
        Ok(())
    }

    // Shared decode loop over a FRESH context (dropped on return → no KV leak,
    // same design proven in examples/llm_poc.rs). Calls `on_delta` per token.
    fn generate_loop(
        backend: &LlamaBackend,
        model: &LlamaModel,
        n_ctx_max: u32,
        prompt: &str,
        max_tokens: usize,
        cancel: &Arc<AtomicBool>,
        mut on_delta: impl FnMut(&str),
    ) -> Result<(usize, StopReason, f64), String> {
        // Tokenize first (no context needed) so the context can be sized to the
        // actual prompt — saves KV memory and, critically, lets us reject an
        // oversized prompt with a clean error instead of llama.cpp's GGML_ASSERT,
        // which calls abort() (uncatchable in Rust — it kills the whole process).
        let tokens = model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;
        if tokens.is_empty() {
            return Err("prompt tokenized to zero tokens".into());
        }
        let needed = tokens.len() + max_tokens + 8;
        let n_ctx = (needed as u32).min(n_ctx_max).max(512);
        if tokens.len() + 4 >= n_ctx as usize {
            return Err(format!(
                "prompt is {} tokens but the usable context is {} — too long (use a shorter prompt or a session without the full tool preamble)",
                tokens.len(),
                n_ctx
            ));
        }
        let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(n_ctx));
        let mut ctx = model
            .new_context(backend, ctx_params)
            .map_err(|e| format!("new_context: {e}"))?;

        // Prefill in chunks — a single llama_decode must not exceed the context's
        // batch size, or GGML_ASSERT(n_tokens_all <= n_batch) aborts the process.
        const PREFILL_CHUNK: usize = 512;
        let mut batch = LlamaBatch::new(PREFILL_CHUNK, 1);
        let n_prompt = tokens.len();
        let mut pos: i32 = 0;
        let mut last_logit_idx: i32 = 0;
        let mut i = 0;
        while i < n_prompt {
            let end = (i + PREFILL_CHUNK).min(n_prompt);
            batch.clear();
            let mut bi: i32 = 0;
            for j in i..end {
                let is_last = j == n_prompt - 1; // logits only on the final prompt token
                batch
                    .add(tokens[j], pos, &[0], is_last)
                    .map_err(|e| format!("batch.add: {e}"))?;
                if is_last {
                    last_logit_idx = bi;
                }
                pos += 1;
                bi += 1;
            }
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
            i = end;
        }

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_p(0.95, 1), // (p, min_keep) in llama-cpp-2 0.1.x
            LlamaSampler::temp(0.8),
            LlamaSampler::dist(1234),
        ]);
        // Stateful decoder created once — a multi-byte codepoint can straddle two tokens.
        let mut decoder = encoding_rs::UTF_8.new_decoder();

        let mut sample_idx = last_logit_idx;
        let mut n_cur = pos;
        let mut produced = 0usize;

        // Measure generation rate (excludes prefill) → tokens/sec.
        let gen_start = std::time::Instant::now();
        let stop = loop {
            if cancel.load(Ordering::Relaxed) {
                break StopReason::Cancelled;
            }
            // Stop at max_tokens, or before the KV position fills the context
            // (decoding past n_ctx would abort).
            if produced >= max_tokens || (n_cur as u32) >= n_ctx {
                break StopReason::Max;
            }
            let next = sampler.sample(&ctx, sample_idx);
            sampler.accept(next);
            // Stop on ANY end-of-generation token (Qwen etc. have several:
            // <|im_end|>, <|endoftext|>, …), not just the primary EOS.
            if model.is_eog_token(next) {
                break StopReason::Eos;
            }
            // Control/special tokens have no printable piece → render empty
            // rather than erroring the whole stream (TokenToStringError).
            let piece = model
                .token_to_piece(next, &mut decoder, false, None)
                .unwrap_or_default();
            on_delta(&piece);
            produced += 1;

            // KV cache holds everything before; decode only the new token.
            batch.clear();
            batch
                .add(next, n_cur, &[0], true)
                .map_err(|e| format!("batch.add: {e}"))?;
            n_cur += 1;
            sample_idx = 0;
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
        };
        let secs = gen_start.elapsed().as_secs_f64();
        let tok_per_sec = if secs > 0.0 {
            produced as f64 / secs
        } else {
            0.0
        };
        Ok((produced, stop, tok_per_sec))
    }
}
