// ===========================================================================
// ===========================================================================
//
// GOAL: prove the in-process architecture works. NOT performance.
//
// Definition of Done (this file must demonstrate ALL of these):
//   1. Single GGUF model, loaded once.
//   2. Single prompt.
//   3. Streaming tokens (printed as they are produced, not at the end).
//   4. Cancelable generation — an external AtomicBool stops it mid-stream.
//      This is the EXACT mechanism the future `llm_cancel` Tauri command will
//      flip; here a watcher thread flips it after `--cancel-after-ms`.
//   5. No memory leak — `--repeat N` recreates the context per run and drops
//      it; RSS must stay flat (only the model stays resident).
//
// OUT OF SCOPE until this is green: KV-cache reuse, speculative decoding,
// prompt cache, auto backend/quant selection, chat templating, any UI, any
// Tauri invoke. Do not add them here.
//
// Run (a backend feature is required so llama.cpp builds with GPU offload):
//   macOS  : cargo run --release --example llm_poc --features llm-metal  -- model.gguf
//   Windows: cargo run --release --example llm_poc --features llm-vulkan -- model.gguf
//   CPU    : cargo run --release --example llm_poc --features local-llm  -- model.gguf --cpu
//
// Flags: --prompt <s> --max <n> --ctx <n> --gpu-layers <n> --cpu
//        --cancel-after-ms <n> --repeat <n> --seed <n>
//
// API version note: this targets the `llama-cpp-2` 0.1.x API. Two spots are
// the most likely to need a tweak if the crate version differs, both flagged
// inline: `with_n_gpu_layers` integer type and `with_n_ctx` (Option<NonZeroU32>).
// ===========================================================================

use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

/// Minimal CLI config parsed by hand (no clap dependency for a PoC).
struct Args {
    model: PathBuf,
    prompt: String,
    max_tokens: usize,
    n_ctx: u32,
    gpu_layers: u32,
    cancel_after_ms: u64,
    repeat: u32,
    seed: u32,
    two_turn: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut model: Option<PathBuf> = std::env::var("CODEZAL_GGUF").ok().map(PathBuf::from);
    let mut prompt = "The capital of France is".to_string();
    let mut max_tokens = 128usize;
    let mut n_ctx = 2048u32;
    let mut gpu_layers = 999u32; // 999 → offload all layers (llama.cpp clamps to model max)
    let mut cancel_after_ms = 0u64; // 0 → cancellation disabled
    let mut repeat = 1u32;
    let mut seed = 1234u32;
    let mut two_turn = false;

    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        let mut next = || it.next().ok_or_else(|| format!("missing value after {a}"));
        match a.as_str() {
            "--prompt" => prompt = next()?,
            "--max" => max_tokens = next()?.parse().map_err(|_| "bad --max")?,
            "--ctx" => n_ctx = next()?.parse().map_err(|_| "bad --ctx")?,
            "--gpu-layers" => gpu_layers = next()?.parse().map_err(|_| "bad --gpu-layers")?,
            "--cpu" => gpu_layers = 0,
            "--cancel-after-ms" => {
                cancel_after_ms = next()?.parse().map_err(|_| "bad --cancel-after-ms")?
            }
            "--repeat" => repeat = next()?.parse().map_err(|_| "bad --repeat")?,
            "--seed" => seed = next()?.parse().map_err(|_| "bad --seed")?,
            "--two-turn" => two_turn = true,
            other if !other.starts_with("--") => model = Some(PathBuf::from(other)),
            other => return Err(format!("unknown flag {other}")),
        }
    }

    let model = model.ok_or("usage: llm_poc <model.gguf> [flags]  (or set CODEZAL_GGUF)")?;
    Ok(Args {
        model,
        prompt,
        max_tokens,
        n_ctx,
        gpu_layers,
        cancel_after_ms,
        repeat,
        seed,
        two_turn,
    })
}

/// One generation pass over a FRESH context. The context (and its KV memory)
/// is created here and dropped when this function returns — that drop is what
/// keeps memory flat across `--repeat` runs (DoD #5).
fn generate(
    backend: &LlamaBackend,
    model: &LlamaModel,
    args: &Args,
    cancel: &Arc<AtomicBool>,
) -> Result<usize, Box<dyn std::error::Error>> {
    // API note: `with_n_ctx` takes Option<NonZeroU32> in 0.1.x. If your version
    // wants Option<u32>, replace with `.with_n_ctx(Some(args.n_ctx))`.
    let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(args.n_ctx));
    let mut ctx = model.new_context(backend, ctx_params)?;

    // Prefill the prompt. Only the LAST token carries logits (the next-token
    // prediction); the rest just populate the KV cache.
    let tokens = model.str_to_token(&args.prompt, AddBos::Always)?;
    if tokens.is_empty() {
        return Err("prompt tokenized to zero tokens".into());
    }
    let mut batch = LlamaBatch::new(512, 1);
    let last = tokens.len() - 1;
    for (i, tok) in tokens.iter().enumerate() {
        batch.add(*tok, i as i32, &[0], i == last)?;
    }
    ctx.decode(&mut batch)?;

    // Sampler: balanced top_p + temperature + distribution (seeded for repeatable runs).
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::top_p(0.95, 1), // (p, min_keep) in llama-cpp-2 0.1.x
        LlamaSampler::temp(0.8),
        LlamaSampler::dist(args.seed),
    ]);

    // Stateful UTF-8 decoder — MUST be created once and reused, so a multi-byte
    // codepoint split across two tokens decodes correctly.
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    let mut sample_idx = last as i32; // logits sit on the last prefilled token
    let mut n_cur = tokens.len() as i32; // next KV position to write
    let mut produced = 0usize;
    let eos = model.token_eos();

    use std::io::Write;
    let mut out = std::io::stdout();

    let t0 = Instant::now();
    while produced < args.max_tokens {
        // DoD #4: observe the cancel flag every token. Prod path flips the same
        // AtomicBool from the `llm_cancel` command.
        if cancel.load(Ordering::Relaxed) {
            print!("\x1b[2m[cancelled]\x1b[0m");
            out.flush().ok();
            break;
        }

        let next = sampler.sample(&ctx, sample_idx);
        sampler.accept(next);
        if next == eos {
            break;
        }

        // DoD #3: emit immediately, flush so the stream is visible live.
        let piece = model
            .token_to_piece(next, &mut decoder, false, None)
            .unwrap_or_default();
        print!("{piece}");
        out.flush().ok();
        produced += 1;

        // Feed the sampled token back in; KV cache holds everything before it,
        // so we only decode this single new token (index 0 → next sample_idx).
        batch.clear();
        batch.add(next, n_cur, &[0], true)?;
        n_cur += 1;
        sample_idx = 0;
        ctx.decode(&mut batch)?;
    }

    let secs = t0.elapsed().as_secs_f64();
    let tps = if secs > 0.0 {
        produced as f64 / secs
    } else {
        0.0
    };
    eprintln!("\n⚡ {tps:.1} tok/s ({produced} tok / {secs:.2}s)");
    Ok(produced)
    // `ctx`, `batch`, `sampler`, `decoder` all drop here → KV memory freed.
}

/// context: turn 2 shares a long prefix with turn 1, so only the new suffix is
/// prefilled. Proves the mechanic in-process — correct output + a real
/// prefill-time drop — before wiring it into the production worker.
fn two_turn_bench(
    backend: &LlamaBackend,
    model: &LlamaModel,
    args: &Args,
) -> Result<(), Box<dyn std::error::Error>> {
    let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(args.n_ctx));
    let mut ctx = model.new_context(backend, ctx_params)?;
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut sampler = LlamaSampler::greedy(); // deterministic → output is checkable
    let mut batch = LlamaBatch::new(4096, 1);
    let gen = 16usize;
    let eos = model.token_eos();
    // Long shared preamble — stands in for a system prompt / tool block.
    let preamble = "You are a helpful assistant. ".repeat(60);

    // ===== TURN 1 (cold — full prefill) =====
    let p1 = format!("{preamble}\nQ: What is the capital of France? A:");
    let toks1 = model.str_to_token(&p1, AddBos::Always)?;
    let t1 = Instant::now();
    {
        let last = toks1.len() - 1;
        let mut i = 0;
        while i < toks1.len() {
            let end = (i + 512).min(toks1.len());
            batch.clear();
            for j in i..end {
                batch.add(toks1[j], j as i32, &[0], j == last)?;
            }
            ctx.decode(&mut batch)?;
            i = end;
        }
    }
    let prefill1 = t1.elapsed();
    let mut cached = toks1.clone();
    let mut out1 = String::new();
    {
        let mut idx = (toks1.len() - 1) as i32;
        let mut pos = toks1.len() as i32;
        for _ in 0..gen {
            let next = sampler.sample(&ctx, idx);
            sampler.accept(next);
            if next == eos {
                break;
            }
            out1.push_str(
                &model
                    .token_to_piece(next, &mut decoder, false, None)
                    .unwrap_or_default(),
            );
            cached.push(next);
            batch.clear();
            batch.add(next, pos, &[0], true)?;
            pos += 1;
            idx = 0;
            ctx.decode(&mut batch)?;
        }
    }

    // ===== TURN 2 (warm — reuse the shared prefix's KV) =====
    let p2 = format!(
        "{preamble}\nQ: What is the capital of France? A:{out1}\nQ: What is the capital of Japan? A:"
    );
    let toks2 = model.str_to_token(&p2, AddBos::Always)?;
    let mut common = 0usize;
    while common < cached.len() && common < toks2.len() && cached[common] == toks2[common] {
        common += 1;
    }
    // Drop KV positions >= common (turn 1's divergent tail); keep the shared prefix.
    ctx.clear_kv_cache_seq(Some(0), Some(common as u32), None)?;
    let suffix = &toks2[common..];
    let t2 = Instant::now();
    {
        let last = suffix.len() - 1;
        let mut i = 0;
        while i < suffix.len() {
            let end = (i + 512).min(suffix.len());
            batch.clear();
            for j in i..end {
                batch.add(suffix[j], (common + j) as i32, &[0], j == last)?;
            }
            ctx.decode(&mut batch)?;
            i = end;
        }
    }
    let prefill2 = t2.elapsed();
    let mut out2 = String::new();
    {
        let mut idx = (suffix.len() - 1) as i32;
        let mut pos = toks2.len() as i32;
        for _ in 0..gen {
            let next = sampler.sample(&ctx, idx);
            sampler.accept(next);
            if next == eos {
                break;
            }
            out2.push_str(
                &model
                    .token_to_piece(next, &mut decoder, false, None)
                    .unwrap_or_default(),
            );
            batch.clear();
            batch.add(next, pos, &[0], true)?;
            pos += 1;
            idx = 0;
            ctx.decode(&mut batch)?;
        }
    }

    let ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
    eprintln!("\n── KV-reuse benchmark (one persistent context) ──");
    eprintln!(
        "turn 1 (cold): prefilled {} tok in {:.1} ms",
        toks1.len(),
        ms(prefill1)
    );
    eprintln!(
        "turn 2 (warm): prompt {} tok — reused {} shared, prefilled {} new in {:.1} ms",
        toks2.len(),
        common,
        suffix.len(),
        ms(prefill2)
    );
    eprintln!(
        "prefill speedup: {:.1}x",
        ms(prefill1) / ms(prefill2).max(0.001)
    );
    eprintln!("turn 1 → France: {}", out1.trim());
    eprintln!(
        "turn 2 → Japan:  {}  (expect Tokyo = KV reuse correct)",
        out2.trim()
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;

    // Backend is global and initialized once for the whole process.
    let backend = LlamaBackend::init()?;

    // DoD #1: load the model ONCE, reuse across repeats.
    // API note: `with_n_gpu_layers` is u32 in 0.1.x; older versions used i32
    // (where -1 meant "all"). 999 means "all" for both (llama.cpp clamps).
    let model_params = LlamaModelParams::default().with_n_gpu_layers(args.gpu_layers);
    eprintln!(
        "loading {} (gpu_layers={}, ctx={}) …",
        args.model.display(),
        args.gpu_layers,
        args.n_ctx
    );
    let model = LlamaModel::load_from_file(&backend, &args.model, &model_params)?;
    eprintln!("loaded. prompt: {:?}\n", args.prompt);

    if args.two_turn {
        return two_turn_bench(&backend, &model, &args);
    }

    for run in 1..=args.repeat {
        if args.repeat > 1 {
            eprintln!("\n── run {run}/{} ──", args.repeat);
        }

        // Fresh cancel flag per run. If requested, a watcher flips it after a
        // delay — this stands in for the external `llm_cancel` command.
        let cancel = Arc::new(AtomicBool::new(false));
        if args.cancel_after_ms > 0 {
            let c = cancel.clone();
            let ms = args.cancel_after_ms;
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(ms));
                c.store(true, Ordering::Relaxed);
            });
        }

        let produced = generate(&backend, &model, &args, &cancel)?;
        eprintln!("\n[{produced} tokens]");
    }

    if args.repeat > 1 {
        eprintln!(
            "\nLeak check: RSS should be flat across the {} runs above \
             (watch Activity Monitor / Task Manager). Each run's context is \
             dropped; only the model stays resident.",
            args.repeat
        );
    }
    Ok(())
}
