//
// We render the model's OWN embedded Jinja chat template (obtained via
// `model.chat_template(None)?.to_string()?`) with minijinja, feeding it
// OpenAI-format messages + tools — instead of leaning on llama-cpp-2's
// oai-compat helpers (`apply_chat_template_oaicompat`), which upstream removed
// after 0.1.146. Owning this frees us to bump the binding / llama.cpp without
// losing chat + tool-call rendering.
//
// Matching llama.cpp's reference render byte-for-byte (verified by the
// chat_render_check example) needs a few things plain minijinja lacks:
//   - Python string methods (.startswith/.split/.strip/…) → minijinja-contrib pycompat.
//   - raise_exception(msg) / strftime_now(fmt) globals templates call.
//   - a `tojson` that mirrors Python json.dumps: insertion-order keys (minijinja's
//     `preserve_order` feature + deserialising STRAIGHT into minijinja Value, since
//     serde_json::Value would alphabetise) and ", " / ": " separators.

use std::io;

use minijinja::{context, Environment, Error, ErrorKind, Value};
use serde::Serialize;

/// serde_json formatter matching Python `json.dumps` default separators
/// (", " between elements, ": " after keys) — what llama.cpp's minja `tojson`
/// emits and what chat templates were trained on.
struct PyJsonFormatter;

impl serde_json::ser::Formatter for PyJsonFormatter {
    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
    fn begin_object_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        w.write_all(b": ")
    }
}

/// `{{ value | tojson }}` — Python-json.dumps-compatible (see PyJsonFormatter).
fn py_tojson(v: &Value) -> Result<String, Error> {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, PyJsonFormatter);
    v.serialize(&mut ser)
        .map_err(|e| Error::new(ErrorKind::InvalidOperation, e.to_string()))?;
    String::from_utf8(buf).map_err(|e| Error::new(ErrorKind::InvalidOperation, e.to_string()))
}

/// Render the model's embedded Jinja `template` with OpenAI-format
/// `messages_json` (+ optional `tools_json`) into a prompt string.
///
/// apply_chat_template_oaicompat).
pub fn render_prompt(
    template: &str,
    messages_json: &str,
    tools_json: Option<&str>,
    add_generation_prompt: bool,
) -> Result<String, String> {
    // Deserialize STRAIGHT into minijinja Value (preserve_order) so object key
    // order survives — serde_json::Value would alphabetise it (BTreeMap).
    let messages: Value =
        serde_json::from_str(messages_json).map_err(|e| format!("messages json: {e}"))?;
    let tools: Option<Value> = match tools_json {
        Some(t) => Some(serde_json::from_str(t).map_err(|e| format!("tools json: {e}"))?),
        None => None,
    };

    let mut env = Environment::new();
    // Python str methods (.startswith/.split/.strip/...) used by HF templates.
    env.set_unknown_method_callback(minijinja_contrib::pycompat::unknown_method_callback);
    // tojson matching Python json.dumps (overrides minijinja's compact builtin).
    env.add_filter("tojson", |v: Value| py_tojson(&v));
    // raise_exception(msg) — templates call it to reject malformed conversations.
    env.add_function("raise_exception", |msg: String| -> Result<Value, Error> {
        Err(Error::new(ErrorKind::InvalidOperation, msg))
    });
    // strftime_now(fmt) — date stamping. Not reproducible and rarely affects
    // behavior; return empty for now (revisit with a real clock if a model needs it).
    env.add_function("strftime_now", |_fmt: String| Value::from(""));

    env.add_template("chat", template)
        .map_err(|e| format!("template parse: {e}"))?;
    let tmpl = env
        .get_template("chat")
        .map_err(|e| format!("get template: {e}"))?;

    tmpl.render(context! {
        messages => messages,
        tools => tools,
        add_generation_prompt => add_generation_prompt,
    })
    .map_err(|e| format!("render: {e}"))
}
