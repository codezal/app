//
// Splits a model's streamed text into OpenAI-format deltas: plain content vs
// tool-call blocks, stripping reasoning channels. Emits the same delta-JSON shape
// the JS bridge frames (`{"content": …}` / `{"tool_calls": […]}`), so we no longer
// depend on the binding's `streaming_state_oaicompat` (removed upstream after 0.1.146).
//
// Two tool/reasoning conventions are handled, distinguished by their markers so a
// single parser serves both model families (the gemma `<|…>` markers never appear
// in a Qwen stream and vice-versa):
//   - Hermes/Qwen: `<tool_call>{json}</tool_call>` + `<think>…</think>`.
//   - Gemma-coder: `<|tool_call>call:fn{key:"val", …}<tool_call|>` (close mirrors
//     the open; older builds used a bare `<tool_call>`) +
//     `<|channel>thought…<channel|>` reasoning channel.
// Anything it cannot parse passes through as content (never silently dropped).
//
// Pure serde_json (no feature gate) so the unit tests run in a plain `cargo test`.

use serde_json::{json, Value};

// Hermes / Qwen.
const TC_OPEN: &str = "<tool_call>";
const TC_CLOSE: &str = "</tool_call>";
const TH_OPEN: &str = "<think>";
const TH_CLOSE: &str = "</think>";
// Gemma-coder (bespoke). The tool-call close mirrors the open: `<|tool_call>` opens,
// `<tool_call|>` closes (same `<|…>` / `<…|>` convention as the channel markers).
// Older builds emitted a bare `<tool_call>`; both are accepted (a gemma block always
// starts with `<|tool_call>`, and a Qwen stream never emits `<|tool_call>`, so the
// bare form stays unambiguous here).
const GC_OPEN: &str = "<|channel>";
const GC_CLOSE: &str = "<channel|>";
const GTC_OPEN: &str = "<|tool_call>";
const GTC_CLOSE: &str = "<tool_call|>";
const GTC_CLOSE_BARE: &str = "<tool_call>";
const GQ: &str = "<|\"|>"; // gemma string delimiter (older builds; newer use plain ")

// Every opening marker, longest-first so a more specific marker (e.g. the gemma
// "<|tool_call>") is matched before a prefix of it would be.
const OPENS: [&str; 4] = [TH_OPEN, GC_OPEN, GTC_OPEN, TC_OPEN];

/// Streaming splitter. Feed pieces with [`push`](Self::push); finish with
/// [`flush`](Self::flush). Each returns zero or more OpenAI delta JSON strings.
pub struct ChatStreamParser {
    buf: String,
    tool_index: usize,
}

impl Default for ChatStreamParser {
    fn default() -> Self {
        Self {
            buf: String::new(),
            tool_index: 0,
        }
    }
}

impl ChatStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a generated piece; returns any complete deltas it unlocked.
    pub fn push(&mut self, piece: &str) -> Vec<String> {
        self.buf.push_str(piece);
        self.drain(false)
    }

    /// End of generation — flush buffered content / an unterminated block.
    pub fn flush(&mut self) -> Vec<String> {
        self.drain(true)
    }

    fn drain(&mut self, final_: bool) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            // Earliest of any opening marker.
            let first = OPENS.iter().filter_map(|m| self.buf.find(m)).min();

            let Some(pos) = first else {
                // No marker ahead. Emit content, holding back a tail that could be
                // the start of an opening tag split across pieces.
                let cut = if final_ {
                    self.buf.len()
                } else {
                    safe_emit_len(&self.buf)
                };
                if cut > 0 {
                    let c: String = self.buf.drain(..cut).collect();
                    push_content(&mut out, &c);
                }
                return out;
            };

            // Emit content before the marker, then re-evaluate from the marker.
            if pos > 0 {
                let c: String = self.buf.drain(..pos).collect();
                push_content(&mut out, &c);
                continue;
            }

            // buf now STARTS with one of the markers.
            if self.buf.starts_with(TH_OPEN) {
                match self.strip_block(TH_OPEN, TH_CLOSE, final_) {
                    Continue::Stripped => continue,
                    Continue::Wait => return out,
                }
            } else if self.buf.starts_with(GC_OPEN) {
                // Gemma reasoning channel — drop "<|channel>…<channel|>" like <think>.
                match self.strip_block(GC_OPEN, GC_CLOSE, final_) {
                    Continue::Stripped => continue,
                    Continue::Wait => return out,
                }
            } else if self.buf.starts_with(GTC_OPEN) {
                match self.take_gemma_block(final_, &mut out) {
                    Some(inner) => {
                        self.emit_gemma_tool_call(&inner, &mut out);
                        continue;
                    }
                    None => return out,
                }
            } else {
                // Hermes <tool_call>…</tool_call>.
                match self.take_block(TC_OPEN, TC_CLOSE, final_, &mut out) {
                    Some(inner) => {
                        self.emit_tool_call(&inner, &mut out);
                        continue;
                    }
                    None => return out,
                }
            }
        }
    }

    /// Drop an `<open>…<close>` reasoning block. `buf` must start with `open`.
    fn strip_block(&mut self, open: &str, close: &str, final_: bool) -> Continue {
        match self.buf[open.len()..].find(close) {
            Some(rel) => {
                let end = open.len() + rel + close.len();
                self.buf.drain(..end);
                Continue::Stripped
            }
            None => {
                if final_ {
                    self.buf.clear(); // unterminated reasoning — drop it
                }
                Continue::Wait
            }
        }
    }

    /// Extract the inner text of an `<open>…<close>` block (trimmed) and consume it
    /// from `buf` (which must start with `open`). Returns None when it must wait for
    /// more input; on `final_` with no close, surfaces the raw text as content.
    fn take_block(
        &mut self,
        open: &str,
        close: &str,
        final_: bool,
        out: &mut Vec<String>,
    ) -> Option<String> {
        match self.buf[open.len()..].find(close) {
            Some(rel) => {
                let inner = self.buf[open.len()..open.len() + rel].trim().to_string();
                let end = open.len() + rel + close.len();
                self.buf.drain(..end);
                Some(inner)
            }
            None => {
                if final_ {
                    let raw: String = std::mem::take(&mut self.buf);
                    push_content(out, &raw);
                }
                None
            }
        }
    }

    /// Gemma tool block. Opens `<|tool_call>`; closes with the mirror `<tool_call|>`
    /// (live gemma4-coding) or, on older builds, a bare `<tool_call>`. Whichever close
    /// appears first ends the block. Like [`take_block`](Self::take_block), it waits for
    /// more input until a close arrives; on `final_` with none, surfaces the raw text.
    fn take_gemma_block(&mut self, final_: bool, out: &mut Vec<String>) -> Option<String> {
        let body = &self.buf[GTC_OPEN.len()..];
        let close = [GTC_CLOSE, GTC_CLOSE_BARE]
            .iter()
            .filter_map(|c| body.find(c).map(|rel| (rel, c.len())))
            .min_by_key(|&(rel, _)| rel);
        match close {
            Some((rel, close_len)) => {
                let inner = body[..rel].trim().to_string();
                let end = GTC_OPEN.len() + rel + close_len;
                self.buf.drain(..end);
                Some(inner)
            }
            None => {
                if final_ {
                    let raw: String = std::mem::take(&mut self.buf);
                    push_content(out, &raw);
                }
                None
            }
        }
    }

    fn emit_tool_call(&mut self, inner: &str, out: &mut Vec<String>) {
        match serde_json::from_str::<Value>(inner) {
            Ok(v) => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or_default();
                if name.is_empty() {
                    push_content(out, &format!("{TC_OPEN}{inner}{TC_CLOSE}"));
                    return;
                }
                let args = v.get("arguments").cloned().unwrap_or_else(|| json!({}));
                self.push_tool_call(name, &args, out);
            }
            // (`<function=NAME><parameter=KEY>VAL</parameter>…</function>`); o da
            Err(_) => match parse_xml_tool_call(inner) {
                Some((name, args)) => self.push_tool_call(&name, &args, out),
                None => push_content(out, &format!("{TC_OPEN}{inner}{TC_CLOSE}")),
            },
        }
    }

    /// Gemma tool syntax: `call:FN{key:<|"|>val<|"|>, key2:false, …}`.
    fn emit_gemma_tool_call(&mut self, inner: &str, out: &mut Vec<String>) {
        let body = inner.strip_prefix("call:").unwrap_or(inner).trim();
        let (name, argstr) = match body.find('{') {
            Some(i) => (
                body[..i].trim(),
                body[i + 1..].trim_end().strip_suffix('}').unwrap_or(""),
            ),
            None => (body, ""),
        };
        if name.is_empty() {
            // Unparseable — surface raw so nothing is silently lost.
            push_content(out, &format!("{GTC_OPEN}{inner}{GTC_CLOSE}"));
            return;
        }
        let args = parse_gemma_args(argstr);
        self.push_tool_call(name, &args, out);
    }

    fn push_tool_call(&mut self, name: &str, args: &Value, out: &mut Vec<String>) {
        // OpenAI requires the call arguments as a JSON *string*.
        let args_str = serde_json::to_string(args).unwrap_or_else(|_| "{}".into());
        out.push(
            json!({
                "tool_calls": [{
                    "index": self.tool_index,
                    "id": format!("call_{}", self.tool_index),
                    "type": "function",
                    "function": { "name": name, "arguments": args_str },
                }]
            })
            .to_string(),
        );
        self.tool_index += 1;
    }
}

enum Continue {
    Stripped,
    Wait,
}

fn push_content(out: &mut Vec<String>, text: &str) {
    if !text.is_empty() {
        out.push(json!({ "content": text }).to_string());
    }
}

/// Parse gemma's `key:<|"|>val<|"|>, key2:val2` argument list into a JSON object.
/// String values are wrapped in `<|"|>…<|"|>`; bare values are coerced to bool /
/// number when possible, else kept as a string.
fn parse_gemma_args(s: &str) -> Value {
    let mut map = serde_json::Map::new();
    for pair in split_top_level_commas(s) {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let Some(colon) = pair.find(':') else {
            continue;
        };
        let key = pair[..colon].trim().trim_matches('"');
        let raw = pair[colon + 1..].trim();
        let val = if let Some(inner) = raw.strip_prefix(GQ).and_then(|r| r.strip_suffix(GQ)) {
            Value::String(inner.to_string())
        } else if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
            // Newer gemma builds wrap strings in plain `"…"` (yerine `<|"|>…<|"|>`).
            serde_json::from_str::<String>(raw)
                .map(Value::String)
                .unwrap_or_else(|_| Value::String(raw[1..raw.len() - 1].to_string()))
        } else if raw == "true" {
            Value::Bool(true)
        } else if raw == "false" {
            Value::Bool(false)
        } else if let Ok(n) = raw.parse::<i64>() {
            Value::from(n)
        } else if let Ok(f) = raw.parse::<f64>() {
            Value::from(f)
        } else {
            Value::String(raw.trim_matches('"').to_string())
        };
        map.insert(key.to_string(), val);
    }
    Value::Object(map)
}

/// Split on commas that are NOT inside a string (gemma values can contain commas,
/// e.g. a glob list). Strings are delimited by `<|"|>…<|"|>` (older builds) or plain
/// `"…"` (newer builds); a comma inside either is protected. GQ is checked first so
/// its embedded `"` is consumed whole, not mistaken for a plain-quote toggle.
fn split_top_level_commas(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let bytes = s.as_bytes();
    let mut in_gq = false;
    let mut in_q = false;
    let mut last = 0;
    let mut i = 0;
    while i < s.len() {
        if in_q && bytes[i] == b'\\' {
            let next = i + 1;
            i = next + s[next..].chars().next().map_or(1, |c| c.len_utf8());
            continue;
        }
        if s.is_char_boundary(i) && s[i..].starts_with(GQ) {
            in_gq = !in_gq;
            i += GQ.len();
            continue;
        }
        if !in_gq && bytes[i] == b'"' {
            in_q = !in_q;
            i += 1;
            continue;
        }
        if !in_gq && !in_q && bytes[i] == b',' {
            parts.push(s[last..i].to_string());
            last = i + 1;
        }
        i += 1;
    }
    parts.push(s[last..].to_string());
    parts
}

/// Longest prefix length of `buf` that cannot be the start of any opening marker —
/// so a marker split across pieces is never half-streamed.
fn safe_emit_len(buf: &str) -> usize {
    let bytes = buf.as_bytes();
    let mut hold = 0usize;
    for tag in OPENS.iter().map(|t| t.as_bytes()) {
        let maxk = tag.len().min(bytes.len());
        for k in 1..=maxk {
            if bytes.ends_with(&tag[..k]) && buf.is_char_boundary(bytes.len() - k) {
                hold = hold.max(k);
            }
        }
    }
    buf.len() - hold
}

fn parse_xml_tool_call(inner: &str) -> Option<(String, Value)> {
    let fstart = inner.find("<function=")?;
    let after = &inner[fstart + "<function=".len()..];
    let name_end = after.find('>')?;
    let name = after[..name_end].trim().to_string();
    if name.is_empty() {
        return None;
    }
    let mut args = serde_json::Map::new();
    let mut rest = &after[name_end + 1..];
    while let Some(ps) = rest.find("<parameter=") {
        let pa = &rest[ps + "<parameter=".len()..];
        let Some(ke) = pa.find('>') else { break };
        let key = pa[..ke].trim().to_string();
        let val_start = &pa[ke + 1..];
        let close = val_start.find("</parameter>");
        let bound = [
            close,
            val_start.find("<parameter="),
            val_start.find("</function>"),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(val_start.len());
        let val = val_start[..bound].trim();
        let next = if close == Some(bound) {
            &val_start[bound + "</parameter>".len()..]
        } else {
            &val_start[bound..]
        };
        if !key.is_empty() {
            args.insert(key, coerce_arg(val));
        }
        rest = next;
    }
    Some((name, Value::Object(args)))
}

fn coerce_arg(s: &str) -> Value {
    match s {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => {
            if let Ok(n) = s.parse::<i64>() {
                Value::from(n)
            } else if let Ok(f) = s.parse::<f64>() {
                Value::from(f)
            } else {
                Value::String(s.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Feed pieces then flush; collect all delta JSON strings.
    fn feed(pieces: &[&str]) -> Vec<String> {
        let mut p = ChatStreamParser::new();
        let mut out = Vec::new();
        for piece in pieces {
            out.extend(p.push(piece));
        }
        out.extend(p.flush());
        out
    }

    // Concatenate the content of every content-delta.
    fn content(deltas: &[String]) -> String {
        deltas
            .iter()
            .filter_map(|d| {
                let v: Value = serde_json::from_str(d).ok()?;
                Some(v.get("content")?.as_str()?.to_string())
            })
            .collect()
    }

    fn tool_calls(deltas: &[String]) -> Vec<Value> {
        deltas
            .iter()
            .filter_map(|d| {
                let v: Value = serde_json::from_str(d).ok()?;
                v.get("tool_calls")?.get(0).cloned()
            })
            .collect()
    }

    #[test]
    fn qwen_xml_tool_call() {
        // <tool_call><function=NAME><parameter=K>V</parameter></function></tool_call>
        let out = feed(&[
            "Bakalım. ",
            "<tool_call><function=glob>\n<parameter=pattern>\n**/*.html\n</parameter>\n</function></tool_call>",
        ]);
        assert!(content(&out).contains("Bakalım."));
        assert!(!content(&out).contains("<function="));
        let calls = tool_calls(&out);
        assert_eq!(calls.len(), 1);
        let f = calls[0].get("function").unwrap();
        assert_eq!(f.get("name").unwrap().as_str().unwrap(), "glob");
        let args: Value =
            serde_json::from_str(f.get("arguments").unwrap().as_str().unwrap()).unwrap();
        assert_eq!(args.get("pattern").unwrap().as_str().unwrap(), "**/*.html");
    }

    #[test]
    fn qwen_xml_tool_call_coerces_number() {
        let out = feed(&[
            "<tool_call><function=read_file><parameter=path>a.ts</parameter><parameter=offset>732</parameter></function></tool_call>",
        ]);
        let calls = tool_calls(&out);
        let args: Value = serde_json::from_str(
            calls[0]
                .get("function")
                .unwrap()
                .get("arguments")
                .unwrap()
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(args.get("path").unwrap().as_str().unwrap(), "a.ts");
        assert_eq!(args.get("offset").unwrap().as_i64().unwrap(), 732);
    }

    #[test]
    fn xml_missing_close_tag_keeps_params() {
        let (name, args) = parse_xml_tool_call(
            "<function=read_file><parameter=path>a.ts<parameter=offset>5</parameter></function>",
        )
        .unwrap();
        assert_eq!(name, "read_file");
        assert_eq!(args.get("path").unwrap().as_str().unwrap(), "a.ts");
        assert_eq!(args.get("offset").unwrap().as_i64().unwrap(), 5);
    }

    #[test]
    fn xml_missing_close_tag_falls_back_to_function_end() {
        let (name, args) =
            parse_xml_tool_call("<function=glob><parameter=pattern>**/*.rs</function>").unwrap();
        assert_eq!(name, "glob");
        assert_eq!(args.get("pattern").unwrap().as_str().unwrap(), "**/*.rs");
    }

    #[test]
    fn split_commas_escape_multibyte_safe() {
        let parts = split_top_level_commas(r#""a\şb",c"#);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1], "c");
    }

    #[test]
    fn plain_content_reassembles() {
        let out = feed(&["Hel", "lo ", "world"]);
        assert_eq!(content(&out), "Hello world");
        assert!(tool_calls(&out).is_empty());
    }

    #[test]
    fn single_tool_call() {
        let out = feed(&[
            "<tool_call>\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"a.txt\"}}\n</tool_call>",
        ]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0]["function"]["name"], "read_file");
        assert_eq!(tcs[0]["function"]["arguments"], "{\"path\":\"a.txt\"}");
        assert_eq!(tcs[0]["id"], "call_0");
        assert_eq!(tcs[0]["index"], 0);
    }

    #[test]
    fn content_then_tool_call() {
        let out = feed(&["Reading it. <tool_call>{\"name\":\"x\",\"arguments\":{}}</tool_call>"]);
        assert_eq!(content(&out), "Reading it. ");
        assert_eq!(tool_calls(&out).len(), 1);
    }

    #[test]
    fn tool_call_split_across_pieces() {
        let out = feed(&[
            "<tool_",
            "call>{\"name\":\"x\",\"argu",
            "ments\":{}}</tool_",
            "call>",
        ]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0]["function"]["name"], "x");
        assert_eq!(content(&out), "");
    }

    #[test]
    fn think_block_stripped() {
        let out = feed(&["<think>step one</think>the answer"]);
        assert_eq!(content(&out), "the answer");
    }

    #[test]
    fn think_split_across_pieces() {
        let out = feed(&["pre <thi", "nk>secret", " reasoning</thi", "nk> post"]);
        assert_eq!(content(&out), "pre  post");
    }

    #[test]
    fn lone_angle_bracket_is_content() {
        assert_eq!(content(&feed(&["a < b > c"])), "a < b > c");
    }

    #[test]
    fn two_tool_calls_indexed() {
        let out = feed(&[
            "<tool_call>{\"name\":\"a\",\"arguments\":{}}</tool_call>",
            "<tool_call>{\"name\":\"b\",\"arguments\":{\"k\":1}}</tool_call>",
        ]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 2);
        assert_eq!(tcs[0]["index"], 0);
        assert_eq!(tcs[0]["id"], "call_0");
        assert_eq!(tcs[1]["index"], 1);
        assert_eq!(tcs[1]["id"], "call_1");
        assert_eq!(tcs[1]["function"]["arguments"], "{\"k\":1}");
    }

    #[test]
    fn malformed_tool_call_falls_back_to_content() {
        let out = feed(&["<tool_call>not json</tool_call>"]);
        assert!(tool_calls(&out).is_empty());
        assert_eq!(content(&out), "<tool_call>not json</tool_call>");
    }

    // ── Gemma-coder bespoke format ───────────────────────────────────────────

    #[test]
    fn gemma_channel_stripped() {
        let out = feed(&["<|channel>thought\n<channel|>Merhaba! Nasıl yardımcı olabilirim?"]);
        assert_eq!(content(&out), "Merhaba! Nasıl yardımcı olabilirim?");
        assert!(tool_calls(&out).is_empty());
    }

    #[test]
    fn gemma_tool_call_string_arg() {
        let out = feed(&["<|tool_call>call:read_file{path:<|\"|>index.html<|\"|>}<tool_call>"]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0]["function"]["name"], "read_file");
        assert_eq!(tcs[0]["function"]["arguments"], "{\"path\":\"index.html\"}");
    }

    #[test]
    fn gemma_tool_call_mixed_args() {
        let out = feed(&[
            "<|tool_call>call:glob{pattern:<|\"|>**/*.html<|\"|>, recursive:false}<tool_call>",
        ]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0]["function"]["name"], "glob");
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["pattern"], "**/*.html");
        assert_eq!(args["recursive"], false);
    }

    #[test]
    fn gemma_value_with_comma_preserved() {
        // A comma INSIDE the string must not split the arg.
        let out = feed(&["<|tool_call>call:write{text:<|\"|>a, b, c<|\"|>}<tool_call>"]);
        let tcs = tool_calls(&out);
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["text"], "a, b, c");
    }

    #[test]
    fn gemma_tool_call_split_across_pieces() {
        let out = feed(&["<|tool_", "call>call:ls{path:<|\"|>.<|\"|>}<tool_", "call>"]);
        assert_eq!(tool_calls(&out).len(), 1);
        assert_eq!(content(&out), "");
    }

    #[test]
    fn gemma_content_after_channel_with_tool() {
        let out = feed(&[
            "<|channel>thought<channel|>Okuyorum. <|tool_call>call:read_file{path:<|\"|>a.txt<|\"|>}<tool_call>",
        ]);
        assert_eq!(content(&out), "Okuyorum. ");
        assert_eq!(tool_calls(&out).len(), 1);
    }

    #[test]
    fn gemma_mirror_close_plain_quotes() {
        // Live gemma4-coding: mirror close `<tool_call|>` + plain `"` quotes.
        let out = feed(&["<|tool_call>call:list_dir{path:\".\"}<tool_call|>"]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0]["function"]["name"], "list_dir");
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["path"], ".");
        assert_eq!(content(&out), "");
    }

    #[test]
    fn gemma_mirror_close_split_across_pieces() {
        let out = feed(&["<|tool_call>call:ls{path:\".\"}<tool_", "call|>"]);
        assert_eq!(tool_calls(&out).len(), 1);
        assert_eq!(content(&out), "");
    }

    #[test]
    fn gemma_plain_quote_comma_preserved() {
        let out = feed(&["<|tool_call>call:write{text:\"a, b, c\"}<tool_call|>"]);
        let tcs = tool_calls(&out);
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["text"], "a, b, c");
    }

    #[test]
    fn gemma_unicode_arg_no_panic() {
        let out = feed(&["<|tool_call>call:read_file{path:\"şirket, rapor.html\"}<tool_call|>"]);
        let tcs = tool_calls(&out);
        assert_eq!(tcs.len(), 1);
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["path"], "şirket, rapor.html");
    }

    #[test]
    fn gemma_plain_quote_escape_decoded() {
        let out = feed(&["<|tool_call>call:write{text:\"a \\\"b\\\", c\"}<tool_call|>"]);
        let tcs = tool_calls(&out);
        let args: Value =
            serde_json::from_str(tcs[0]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["text"], "a \"b\", c");
    }

    #[test]
    fn json_tool_call_empty_name_is_content() {
        let out = feed(&["<tool_call>{\"arguments\":{\"path\":\"a.txt\"}}</tool_call>"]);
        assert!(tool_calls(&out).is_empty());
        assert!(content(&out).contains("\"path\":\"a.txt\""));
    }
}
