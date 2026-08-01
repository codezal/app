//!
//! `<workspace>/.codezal/code-map.db` (gitignore'lu — bkz. .codezal/.gitignore).
//!

use regex::Regex;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::LazyLock;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS cm_files (
    path       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cm_symbols (
    id   TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    sig  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS cm_symbols_name ON cm_symbols(name);
CREATE INDEX IF NOT EXISTS cm_symbols_file ON cm_symbols(file);
CREATE TABLE IF NOT EXISTS cm_calls (
    file      TEXT NOT NULL,
    caller_id TEXT NOT NULL,
    name      TEXT NOT NULL,
    line      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cm_calls_name ON cm_calls(name);
CREATE INDEX IF NOT EXISTS cm_calls_file ON cm_calls(file);
CREATE TABLE IF NOT EXISTS cm_strings (
    file  TEXT NOT NULL,
    value TEXT NOT NULL,
    line  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cm_strings_value ON cm_strings(value);
CREATE INDEX IF NOT EXISTS cm_strings_file ON cm_strings(file);
CREATE TABLE IF NOT EXISTS cm_imports (
    file   TEXT NOT NULL,
    target TEXT NOT NULL,
    line   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cm_imports_target ON cm_imports(target);
CREATE INDEX IF NOT EXISTS cm_imports_file ON cm_imports(file);
CREATE TABLE IF NOT EXISTS cm_inherits (
    child  TEXT NOT NULL,
    parent TEXT NOT NULL,
    kind   TEXT NOT NULL,
    file   TEXT NOT NULL,
    line   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cm_inherits_child ON cm_inherits(child);
CREATE INDEX IF NOT EXISTS cm_inherits_parent ON cm_inherits(parent);
CREATE TABLE IF NOT EXISTS cm_xlang (
    ts_name TEXT NOT NULL,
    rs_name TEXT NOT NULL,
    ts_file TEXT NOT NULL,
    rs_file TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cm_xlang_ts ON cm_xlang(ts_name);
CREATE INDEX IF NOT EXISTS cm_xlang_rs ON cm_xlang(rs_name);
";

pub fn open(workspace: &str) -> Result<Connection, String> {
    let dir = Path::new(workspace).join(".codezal");
    std::fs::create_dir_all(&dir).map_err(|e| format!("code-map dir: {e}"))?;
    let conn =
        Connection::open(dir.join("code-map.db")).map_err(|e| format!("code-map open: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| format!("code-map pragma: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(estr)
}

fn estr(e: impl std::fmt::Display) -> String {
    format!("code-map db: {e}")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hash_of(text: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Symbol {
    pub id: String,
    pub file: String,
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub sig: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StringRef {
    pub file: String,
    pub line: u32,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportRef {
    pub file: String,
    pub target: String,
    pub line: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct InheritRef {
    pub child: String,
    pub parent: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HierarchyBundle {
    pub parents: Vec<InheritRef>,
    pub children: Vec<InheritRef>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct XlangRef {
    pub ts_name: String,
    pub rs_name: String,
    pub ts_file: String,
    pub rs_file: String,
}

// NOT: Rust `regex` lookbehind/lookahead DESTEKLEMEZ. Tek lookahead Go type

#[derive(Debug, Clone, Default)]
pub struct ParsedFile {
    pub symbols: Vec<Symbol>,
    pub raw_calls: Vec<RawCall>,
    pub owner_by_line: Vec<String>,
    /// Extracted string literals: (value, line).
    pub strings: Vec<(String, u32)>,
    /// Import targets: (raw_target, line).
    pub imports: Vec<(String, u32)>,
    /// Inheritance: (child, parent, kind, line).
    pub inherits: Vec<(String, String, String, u32)>,
    /// #[tauri::command] fn names (Rust files only).
    pub tauri_commands: Vec<String>,
    /// invoke("name") calls (TS files only): (name, line).
    pub invoke_calls: Vec<(String, u32)>,
}

#[derive(Debug, Clone)]
pub struct RawCall {
    pub name: String,
    pub line: u32,
}

static PATTERNS: LazyLock<Vec<(&'static str, Vec<(&'static str, Regex)>)>> = LazyLock::new(|| {
    let p = |s: &str| Regex::new(s).expect("code_map: invalid regex");
    vec![
        (
            "ts",
            vec![
                (
                    "function",
                    p(
                        r"(?m)(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]",
                    ),
                ),
                (
                    "class",
                    p(r"(?m)(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)"),
                ),
                (
                    "interface",
                    p(r"(?m)(?:^|\s)(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)"),
                ),
                (
                    "type",
                    p(r"(?m)(?:^|\s)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*="),
                ),
                (
                    "enum",
                    p(r"(?m)(?:^|\s)(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)"),
                ),
                (
                    "const",
                    p(
                        r"(?m)(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=\s*(?:async\s*)?\([^)]*\)\s*=>)",
                    ),
                ),
                (
                    "method",
                    p(
                        r"(?m)^\s+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]",
                    ),
                ),
            ],
        ),
        (
            "py",
            vec![
                (
                    "function",
                    p(r"(?m)^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\("),
                ),
                ("class", p(r"(?m)^\s*class\s+([A-Za-z_]\w*)")),
            ],
        ),
        (
            "rs",
            vec![
                (
                    "function",
                    p(r"(?m)(?:^|\s)(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)"),
                ),
                (
                    "struct",
                    p(r"(?m)(?:^|\s)(?:pub\s+)?struct\s+([A-Za-z_]\w*)"),
                ),
                ("enum", p(r"(?m)(?:^|\s)(?:pub\s+)?enum\s+([A-Za-z_]\w*)")),
            ],
        ),
        (
            "go",
            vec![
                (
                    "function",
                    p(r"(?m)^func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)"),
                ),
                ("struct", p(r"(?m)^type\s+([A-Za-z_]\w*)\s+struct")),
                ("type", p(r"(?m)^type\s+([A-Za-z_]\w*)\s+(\w+)")),
            ],
        ),
        (
            "java",
            vec![
                (
                    "class",
                    p(
                        r"(?m)(?:^|\s)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|static\s+)*class\s+([A-Za-z_]\w*)",
                    ),
                ),
                (
                    "interface",
                    p(
                        r"(?m)(?:^|\s)(?:public\s+|private\s+|protected\s+)*interface\s+([A-Za-z_]\w*)",
                    ),
                ),
                (
                    "method",
                    p(
                        r"(?m)^\s+(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)+\S+\s+([A-Za-z_]\w*)\s*\(",
                    ),
                ),
            ],
        ),
    ]
});

static CALL_SITE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([A-Za-z_$][\w$]*)\s*\(").expect("code_map: call regex"));

static KEYWORDS: LazyLock<Vec<(&'static str, HashSet<&'static str>)>> = LazyLock::new(|| {
    let s = |w: &[&'static str]| w.iter().copied().collect::<HashSet<_>>();
    vec![
        (
            "ts",
            s(&[
                "if",
                "else",
                "for",
                "while",
                "do",
                "switch",
                "case",
                "return",
                "typeof",
                "instanceof",
                "in",
                "of",
                "new",
                "void",
                "await",
                "yield",
                "throw",
                "catch",
                "try",
                "finally",
                "import",
                "export",
                "from",
                "as",
                "is",
                "function",
                "class",
                "interface",
                "type",
                "enum",
                "const",
                "let",
                "var",
                "extends",
                "implements",
                "this",
                "super",
                "true",
                "false",
                "null",
                "undefined",
            ]),
        ),
        (
            "py",
            s(&[
                "if", "elif", "else", "for", "while", "return", "import", "from", "as", "with",
                "def", "class", "lambda", "yield", "raise", "try", "except", "finally", "pass",
                "True", "False", "None", "print", "and", "or", "not", "in", "is",
            ]),
        ),
        (
            "rs",
            s(&[
                "if", "else", "for", "while", "loop", "match", "return", "let", "mut", "fn", "pub",
                "use", "mod", "struct", "enum", "impl", "trait", "where", "as", "self", "Self",
                "super", "crate", "ref", "true", "false",
            ]),
        ),
        (
            "go",
            s(&[
                "if",
                "else",
                "for",
                "switch",
                "case",
                "default",
                "return",
                "func",
                "type",
                "struct",
                "interface",
                "package",
                "import",
                "go",
                "defer",
                "var",
                "const",
                "map",
                "chan",
                "select",
                "range",
                "true",
                "false",
                "nil",
            ]),
        ),
        (
            "java",
            s(&[
                "if",
                "else",
                "for",
                "while",
                "do",
                "switch",
                "case",
                "return",
                "new",
                "class",
                "interface",
                "public",
                "private",
                "protected",
                "static",
                "final",
                "abstract",
                "void",
                "this",
                "super",
                "throw",
                "throws",
                "try",
                "catch",
                "finally",
                "true",
                "false",
                "null",
            ]),
        ),
    ]
});

// --- String literal extraction ---
static STRING_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')"#)
        .expect("code_map: string regex")
});
const MIN_STRING_LEN: usize = 3;

// --- Import extraction (per language) ---
static IMPORT_TS_RE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r#"(?m)(?:import|export)\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]"#).unwrap(),
        Regex::new(r#"require\s*\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap(),
    ]
});
static IMPORT_PY_RE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?m)^\s*from\s+([\w.]+)\s+import").unwrap(),
        Regex::new(r"(?m)^\s*import\s+([\w.]+)").unwrap(),
    ]
});
static IMPORT_RS_RE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?m)^\s*(?:pub\s+)?use\s+(?:crate::)?([\w:]+)").unwrap(),
        Regex::new(r"(?m)^\s*(?:pub\s+)?mod\s+(\w+)").unwrap(),
    ]
});
static IMPORT_GO_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^\s*(?:\w+\s+)?"([^"]+)""#).unwrap());
static IMPORT_JAVA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*import\s+(?:static\s+)?([\w.]+)").unwrap());

// --- Inheritance extraction ---
static INHERIT_TS_EXTENDS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)class\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)").unwrap()
});
static INHERIT_TS_IMPLEMENTS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)class\s+([A-Za-z_$][\w$]*)[^{]*implements\s+([^{]+)").unwrap()
});
/// `interface Foo extends Bar, Baz {`
static INHERIT_TS_IFACE_EXTENDS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)interface\s+([A-Za-z_$][\w$]*)\s+extends\s+([^{]+)").unwrap()
});
static INHERIT_RS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)impl\s+([A-Za-z_]\w*)\s+for\s+([A-Za-z_]\w*)").unwrap());
static INHERIT_PY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)class\s+([A-Za-z_]\w*)\s*\(([^)]+)\)").unwrap());
static INHERIT_JAVA_EXTENDS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)class\s+([A-Za-z_]\w*)\s+extends\s+([A-Za-z_]\w*)").unwrap());
static INHERIT_JAVA_IMPLEMENTS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)class\s+([A-Za-z_]\w*)[^{]*implements\s+([^{]+)").unwrap());

// --- Tauri cross-language ---
static TAURI_CMD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)#\[tauri::command\]\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)").unwrap()
});
static INVOKE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"invoke\s*(?:<[^>]*>)?\s*\(\s*["']([A-Za-z_]\w*)["']"#).unwrap());

fn patterns_for(lang: &str) -> &'static [(&'static str, Regex)] {
    PATTERNS
        .iter()
        .find(|(l, _)| *l == lang)
        .map(|(_, ps)| ps.as_slice())
        .unwrap_or(&[])
}

fn keywords_for(lang: &str) -> Option<&'static HashSet<&'static str>> {
    KEYWORDS.iter().find(|(l, _)| *l == lang).map(|(_, k)| k)
}

pub fn ext_to_lang(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        ".ts" | ".tsx" | ".js" | ".jsx" | ".mts" | ".mjs" | ".cjs" => Some("ts"),
        ".html" | ".htm" => Some("ts"),
        ".py" => Some("py"),
        ".rs" => Some("rs"),
        ".go" => Some("go"),
        ".java" => Some("java"),
        _ => None,
    }
}

fn build_line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, &b) in text.as_bytes().iter().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

fn line_at(line_starts: &[usize], offset: usize) -> u32 {
    line_starts.partition_point(|&s| s <= offset) as u32
}

fn line_span(line_starts: &[usize], text: &str, line: u32) -> (usize, usize) {
    let start = line_starts[(line - 1) as usize];
    let end = text[start..]
        .find('\n')
        .map(|p| start + p)
        .unwrap_or(text.len());
    (start, end)
}

fn def_end_line(
    text: &str,
    line_starts: &[usize],
    def_offset: usize,
    def_line: u32,
    next_def_offset: usize,
    line_count: u32,
) -> u32 {
    let bytes = text.as_bytes();
    enum Scan {
        Code,
        Str(u8),
        Line,
        Block,
    }
    let search_end = next_def_offset.min(text.len());
    if def_offset < search_end {
        if let Some(rel) = text[def_offset..search_end].find('{') {
            let mut depth = 0i32;
            let mut i = def_offset + rel;
            let mut st = Scan::Code;
            while i < text.len() {
                let b = bytes[i];
                match st {
                    Scan::Code => match b {
                        b'"' | b'`' => st = Scan::Str(b),
                        b'/' if i + 1 < text.len() && bytes[i + 1] == b'/' => {
                            st = Scan::Line;
                            i += 1;
                        }
                        b'/' if i + 1 < text.len() && bytes[i + 1] == b'*' => {
                            st = Scan::Block;
                            i += 1;
                        }
                        b'{' => depth += 1,
                        b'}' => {
                            depth -= 1;
                            if depth == 0 {
                                return line_at(line_starts, i);
                            }
                        }
                        _ => {}
                    },
                    Scan::Str(q) => {
                        if b == b'\\' {
                            i += 1;
                        } else if b == q {
                            st = Scan::Code;
                        }
                    }
                    Scan::Line => {
                        if b == b'\n' {
                            st = Scan::Code;
                        }
                    }
                    Scan::Block => {
                        if b == b'*' && i + 1 < text.len() && bytes[i + 1] == b'/' {
                            st = Scan::Code;
                            i += 1;
                        }
                    }
                }
                i += 1;
            }
        }
    }
    let indent_of = |line: u32| -> usize {
        let (s, e) = line_span(line_starts, text, line);
        let seg = &text[s..e];
        seg.len() - seg.trim_start().len()
    };
    let base = indent_of(def_line);
    let mut end = def_line;
    let mut ln = def_line + 1;
    while ln <= line_count {
        let (s, e) = line_span(line_starts, text, ln);
        if text[s..e].trim().is_empty() {
            ln += 1;
            continue;
        }
        if indent_of(ln) > base {
            end = ln;
            ln += 1;
        } else {
            break;
        }
    }
    end
}

pub fn parse_source(file: &str, text: &str, lang: &str) -> ParsedFile {
    let patterns = patterns_for(lang);
    let line_starts = build_line_starts(text);
    let line_count = line_starts.len() as u32;

    let mut symbols: Vec<Symbol> = Vec::new();
    let mut def_at_line: Vec<(u32, usize, String)> = Vec::new();

    let empty_kw = HashSet::new();
    let kw_set = keywords_for(lang).unwrap_or(&empty_kw);
    for (kind, re) in patterns {
        for caps in re.captures_iter(text) {
            if lang == "go" && *kind == "type" && caps.get(2).map(|m| m.as_str()) == Some("struct")
            {
                continue;
            }
            let m = match caps.get(1) {
                Some(m) => m,
                None => continue,
            };
            let name = m.as_str();
            // Skip language keywords (e.g. `for (…) {` / `if (…) {` matched by
            // the TS "method" pattern) — they are control-flow, not definitions.
            if kw_set.contains(name) {
                continue;
            }
            let offset = m.start();
            let line = line_at(&line_starts, offset);
            let id = format!("{file}::{name}::{line}");
            // sig starts from the beginning of the line so it captures
            // leading keywords like "export" / "pub" (needed by q_dead).
            let line_start = line_starts[(line - 1) as usize];
            let line_end = text[line_start..]
                .find('\n')
                .map(|p| line_start + p)
                .unwrap_or(text.len());
            let sig: String = text[line_start..line_end]
                .trim()
                .chars()
                .take(160)
                .collect();
            symbols.push(Symbol {
                id: id.clone(),
                file: file.to_string(),
                name: name.to_string(),
                kind: kind.to_string(),
                line,
                sig,
            });
            def_at_line.push((line, offset, id));
        }
    }

    def_at_line.sort_by_key(|(line, offset, _)| (*line, *offset));
    let mut owner_by_line: Vec<String> = vec![String::new(); (line_count + 1) as usize];
    for i in 0..def_at_line.len() {
        let (start_line, def_offset, ref id) = def_at_line[i];
        let next_off = def_at_line.get(i + 1).map(|d| d.1).unwrap_or(text.len());
        let end_line = def_end_line(
            text,
            &line_starts,
            def_offset,
            start_line,
            next_off,
            line_count,
        );
        for ln in start_line..=end_line.min(line_count) {
            if let Some(slot) = owner_by_line.get_mut(ln as usize) {
                *slot = id.clone();
            }
        }
    }

    let def_lines: HashSet<u32> = def_at_line.iter().map(|(l, _, _)| *l).collect();
    let empty = HashSet::new();
    let keywords = keywords_for(lang).unwrap_or(&empty);
    let mut raw_calls: Vec<RawCall> = Vec::new();
    for caps in CALL_SITE_RE.captures_iter(text) {
        let m = match caps.get(1) {
            Some(m) => m,
            None => continue,
        };
        let name = m.as_str();
        if keywords.contains(name) {
            continue;
        }
        let idx = m.start();
        let line = line_at(&line_starts, idx);
        if def_lines.contains(&line) {
            let line_start = text[..idx].rfind('\n').map(|p| p + 1).unwrap_or(0);
            let line_end = text[idx..]
                .find('\n')
                .map(|p| idx + p)
                .unwrap_or(text.len());
            let first = text[line_start..line_end]
                .find(name)
                .map(|p| line_start + p);
            if first == Some(idx) {
                continue;
            }
        }
        raw_calls.push(RawCall {
            name: name.to_string(),
            line,
        });
    }

    // --- String literal extraction ---
    let mut strings: Vec<(String, u32)> = Vec::new();
    for caps in STRING_RE.captures_iter(text) {
        let val = caps.get(1).or_else(|| caps.get(2));
        if let Some(m) = val {
            let s = m.as_str();
            if s.len() >= MIN_STRING_LEN {
                let line = line_at(&line_starts, m.start());
                strings.push((s.to_string(), line));
            }
        }
    }

    // --- Import extraction ---
    let mut imports: Vec<(String, u32)> = Vec::new();
    match lang {
        "ts" => {
            for re in IMPORT_TS_RE.iter() {
                for caps in re.captures_iter(text) {
                    if let Some(m) = caps.get(1) {
                        let line = line_at(&line_starts, m.start());
                        imports.push((m.as_str().to_string(), line));
                    }
                }
            }
        }
        "py" => {
            for re in IMPORT_PY_RE.iter() {
                for caps in re.captures_iter(text) {
                    if let Some(m) = caps.get(1) {
                        let line = line_at(&line_starts, m.start());
                        imports.push((m.as_str().to_string(), line));
                    }
                }
            }
        }
        "rs" => {
            for re in IMPORT_RS_RE.iter() {
                for caps in re.captures_iter(text) {
                    if let Some(m) = caps.get(1) {
                        let line = line_at(&line_starts, m.start());
                        imports.push((m.as_str().to_string(), line));
                    }
                }
            }
        }
        "go" => {
            for caps in IMPORT_GO_RE.captures_iter(text) {
                if let Some(m) = caps.get(1) {
                    let line = line_at(&line_starts, m.start());
                    imports.push((m.as_str().to_string(), line));
                }
            }
        }
        "java" => {
            for caps in IMPORT_JAVA_RE.captures_iter(text) {
                if let Some(m) = caps.get(1) {
                    let line = line_at(&line_starts, m.start());
                    imports.push((m.as_str().to_string(), line));
                }
            }
        }
        _ => {}
    }

    // --- Inheritance extraction ---
    let mut inherits: Vec<(String, String, String, u32)> = Vec::new();
    match lang {
        "ts" | "java" => {
            let ext_re = if lang == "ts" {
                &INHERIT_TS_EXTENDS_RE
            } else {
                &INHERIT_JAVA_EXTENDS_RE
            };
            for caps in ext_re.captures_iter(text) {
                if let (Some(c), Some(p)) = (caps.get(1), caps.get(2)) {
                    let line = line_at(&line_starts, c.start());
                    inherits.push((
                        c.as_str().to_string(),
                        p.as_str().to_string(),
                        "extends".to_string(),
                        line,
                    ));
                }
            }
            let imp_re = if lang == "ts" {
                &INHERIT_TS_IMPLEMENTS_RE
            } else {
                &INHERIT_JAVA_IMPLEMENTS_RE
            };
            for caps in imp_re.captures_iter(text) {
                if let (Some(c), Some(p)) = (caps.get(1), caps.get(2)) {
                    let line = line_at(&line_starts, c.start());
                    for iface in p.as_str().split(',') {
                        let iface = iface.trim();
                        if !iface.is_empty() {
                            inherits.push((
                                c.as_str().to_string(),
                                iface.to_string(),
                                "implements".to_string(),
                                line,
                            ));
                        }
                    }
                }
            }
            // TS: interface Foo extends Bar, Baz
            if lang == "ts" {
                for caps in INHERIT_TS_IFACE_EXTENDS_RE.captures_iter(text) {
                    if let (Some(c), Some(p)) = (caps.get(1), caps.get(2)) {
                        let line = line_at(&line_starts, c.start());
                        for parent in p.as_str().split(',') {
                            let parent = parent.trim();
                            if !parent.is_empty() {
                                inherits.push((
                                    c.as_str().to_string(),
                                    parent.to_string(),
                                    "extends".to_string(),
                                    line,
                                ));
                            }
                        }
                    }
                }
            }
        }
        "rs" => {
            for caps in INHERIT_RS_RE.captures_iter(text) {
                if let (Some(t), Some(s)) = (caps.get(1), caps.get(2)) {
                    let line = line_at(&line_starts, t.start());
                    inherits.push((
                        s.as_str().to_string(),
                        t.as_str().to_string(),
                        "impl_trait".to_string(),
                        line,
                    ));
                }
            }
        }
        "py" => {
            for caps in INHERIT_PY_RE.captures_iter(text) {
                if let (Some(c), Some(bases)) = (caps.get(1), caps.get(2)) {
                    let line = line_at(&line_starts, c.start());
                    for base in bases.as_str().split(',') {
                        let base = base.trim();
                        if !base.is_empty() && base != "object" {
                            inherits.push((
                                c.as_str().to_string(),
                                base.to_string(),
                                "extends".to_string(),
                                line,
                            ));
                        }
                    }
                }
            }
        }
        _ => {}
    }

    // --- Tauri cross-language extraction ---
    let mut tauri_commands: Vec<String> = Vec::new();
    let mut invoke_calls: Vec<(String, u32)> = Vec::new();
    if lang == "rs" {
        for caps in TAURI_CMD_RE.captures_iter(text) {
            if let Some(m) = caps.get(1) {
                tauri_commands.push(m.as_str().to_string());
            }
        }
    }
    if lang == "ts" {
        for caps in INVOKE_RE.captures_iter(text) {
            if let Some(m) = caps.get(1) {
                let line = line_at(&line_starts, m.start());
                invoke_calls.push((m.as_str().to_string(), line));
            }
        }
    }

    ParsedFile {
        symbols,
        raw_calls,
        owner_by_line,
        strings,
        imports,
        inherits,
        tauri_commands,
        invoke_calls,
    }
}

const IGNORE_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "__pycache__",
    "coverage",
];
const MAX_FILE_BYTES: usize = 512 * 1024;

fn dot_ext(rel: &str) -> Option<String> {
    let file = rel.rsplit(['/', '\\']).next()?;
    let dot = file.rfind('.')?;
    Some(file[dot..].to_string())
}

fn walk(dir: &Path, rel_prefix: &str, out: &mut Vec<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        let path = entry.path();
        let ftype = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ftype.is_symlink() {
            continue;
        }
        if ftype.is_dir() {
            if name.starts_with('.') || IGNORE_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&path, &rel, out);
        } else if dot_ext(&rel).as_deref().and_then(ext_to_lang).is_some() {
            out.push(rel);
        }
    }
}

fn collect_files(workspace: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(workspace), "", &mut out);
    out
}

fn store_file(conn: &Connection, rel: &str, parsed: &ParsedFile, hash: &str) -> Result<(), String> {
    conn.execute("DELETE FROM cm_symbols WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_calls WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_strings WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_imports WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_inherits WHERE file = ?1", [rel])
        .map_err(estr)?;
    {
        let mut stmt = conn
            .prepare("INSERT OR REPLACE INTO cm_symbols (id, file, name, kind, line, sig) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
            .map_err(estr)?;
        for s in &parsed.symbols {
            stmt.execute(params![s.id, s.file, s.name, s.kind, s.line, s.sig])
                .map_err(estr)?;
        }
    }
    {
        let mut stmt = conn
            .prepare("INSERT INTO cm_calls (file, caller_id, name, line) VALUES (?1, ?2, ?3, ?4)")
            .map_err(estr)?;
        for rc in &parsed.raw_calls {
            let caller = parsed
                .owner_by_line
                .get(rc.line as usize)
                .map(String::as_str)
                .unwrap_or("");
            if caller.is_empty() {
                continue;
            }
            stmt.execute(params![rel, caller, rc.name, rc.line])
                .map_err(estr)?;
        }
    }
    {
        let mut stmt = conn
            .prepare("INSERT INTO cm_strings (file, value, line) VALUES (?1, ?2, ?3)")
            .map_err(estr)?;
        for (val, line) in &parsed.strings {
            stmt.execute(params![rel, val, line]).map_err(estr)?;
        }
    }
    {
        let mut stmt = conn
            .prepare("INSERT INTO cm_imports (file, target, line) VALUES (?1, ?2, ?3)")
            .map_err(estr)?;
        for (target, line) in &parsed.imports {
            stmt.execute(params![rel, target, line]).map_err(estr)?;
        }
    }
    {
        let mut stmt = conn
            .prepare("INSERT INTO cm_inherits (child, parent, kind, file, line) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(estr)?;
        for (child, parent, kind, line) in &parsed.inherits {
            stmt.execute(params![child, parent, kind, rel, line])
                .map_err(estr)?;
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO cm_files (path, hash, indexed_at) VALUES (?1, ?2, ?3)",
        params![rel, hash, now_millis()],
    )
    .map_err(estr)?;
    Ok(())
}

fn remove_file(conn: &Connection, rel: &str) -> Result<(), String> {
    conn.execute("DELETE FROM cm_symbols WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_calls WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_strings WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_imports WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_inherits WHERE file = ?1", [rel])
        .map_err(estr)?;
    conn.execute("DELETE FROM cm_files WHERE path = ?1", [rel])
        .map_err(estr)?;
    Ok(())
}

pub fn index_file(conn: &Connection, workspace: &str, rel: &str) -> Result<(), String> {
    if Path::new(rel).is_absolute()
        || rel.starts_with('/')
        || rel.starts_with('\\')
        || rel.split(['/', '\\']).any(|seg| seg == "..")
    {
        return Err(format!("code-map: unsafe path '{rel}'"));
    }
    let lang = match dot_ext(rel).as_deref().and_then(ext_to_lang) {
        Some(l) => l,
        None => return remove_file(conn, rel),
    };
    let abs = Path::new(workspace).join(rel);
    let text = match std::fs::read_to_string(&abs) {
        Ok(t) if t.len() <= MAX_FILE_BYTES => t,
        _ => return remove_file(conn, rel),
    };
    let hash = hash_of(&text);
    let prev: Option<String> =
        match conn.query_row("SELECT hash FROM cm_files WHERE path = ?1", [rel], |r| {
            r.get::<_, String>(0)
        }) {
            Ok(h) => Some(h),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(estr(e)),
        };
    if prev.as_deref() == Some(hash.as_str()) {
        return Ok(());
    }
    let parsed = parse_source(rel, &text, lang);
    store_file(conn, rel, &parsed, &hash)
}

/// Full build istatistikleri.
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct BuildStats {
    pub files: usize,
    pub symbols: usize,
}

pub fn build(workspace: &str) -> Result<BuildStats, String> {
    let conn = open(workspace)?;
    let tx = conn.unchecked_transaction().map_err(estr)?;
    conn.execute_batch(
        "DELETE FROM cm_symbols; DELETE FROM cm_calls; DELETE FROM cm_files; \
         DELETE FROM cm_strings; DELETE FROM cm_imports; DELETE FROM cm_inherits; \
         DELETE FROM cm_xlang;",
    )
    .map_err(estr)?;
    let files = collect_files(workspace);
    // Collect tauri commands and invoke calls for xlang matching.
    let mut rs_cmds: HashMap<String, String> = HashMap::new(); // name -> file
    let mut ts_invokes: Vec<(String, String)> = Vec::new(); // (name, file)
    for rel in &files {
        let lang = dot_ext(rel).as_deref().and_then(ext_to_lang);
        let abs = Path::new(workspace).join(rel);
        let text = match std::fs::read_to_string(&abs) {
            Ok(t) if t.len() <= MAX_FILE_BYTES => t,
            _ => continue,
        };
        let hash = hash_of(&text);
        let parsed = match lang {
            Some(l) => parse_source(rel, &text, l),
            None => continue,
        };
        let _ = store_file(&conn, rel, &parsed, &hash);
        if lang == Some("rs") {
            for cmd in &parsed.tauri_commands {
                rs_cmds.insert(cmd.clone(), rel.clone());
            }
        }
        if lang == Some("ts") {
            for (name, _line) in &parsed.invoke_calls {
                ts_invokes.push((name.clone(), rel.clone()));
            }
        }
    }
    // Build xlang mappings: match invoke("foo") with #[tauri::command] fn foo.
    {
        let mut stmt = conn
            .prepare(
                "INSERT INTO cm_xlang (ts_name, rs_name, ts_file, rs_file) VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(estr)?;
        for (name, ts_file) in &ts_invokes {
            if let Some(rs_file) = rs_cmds.get(name) {
                stmt.execute(params![name, name, ts_file, rs_file])
                    .map_err(estr)?;
            }
        }
    }
    let symbols: i64 = conn
        .query_row("SELECT COUNT(*) FROM cm_symbols", [], |r| r.get(0))
        .map_err(estr)?;
    tx.commit().map_err(estr)?;
    Ok(BuildStats {
        files: files.len(),
        symbols: symbols as usize,
    })
}

const SYM_COLS: &str = "id, file, name, kind, line, sig";

fn row_to_symbol(r: &rusqlite::Row) -> rusqlite::Result<Symbol> {
    Ok(Symbol {
        id: r.get(0)?,
        file: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        line: r.get(4)?,
        sig: r.get(5)?,
    })
}

fn q_search(conn: &Connection, query: &str, limit: u32) -> Result<Vec<Symbol>, String> {
    let escaped = query
        .replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_");
    let sql = format!(
        "SELECT {SYM_COLS} FROM cm_symbols WHERE name LIKE ?1 ESCAPE '\\' ORDER BY length(name), name LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(estr)?;
    let rows = stmt
        .query_map(params![format!("%{escaped}%"), limit], row_to_symbol)
        .map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_callers(conn: &Connection, name: &str) -> Result<Vec<Symbol>, String> {
    let sql = "SELECT DISTINCT s.id, s.file, s.name, s.kind, s.line, s.sig \
               FROM cm_calls c JOIN cm_symbols s ON s.id = c.caller_id \
               WHERE c.name = ?1 ORDER BY s.name";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt.query_map([name], row_to_symbol).map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_callees(conn: &Connection, name: &str) -> Result<Vec<Symbol>, String> {
    let sql = "SELECT DISTINCT t.id, t.file, t.name, t.kind, t.line, t.sig \
               FROM cm_symbols caller \
               JOIN cm_calls c ON c.caller_id = caller.id \
               JOIN cm_symbols t ON t.name = c.name \
               WHERE caller.name = ?1 AND t.id != caller.id ORDER BY t.name";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt.query_map([name], row_to_symbol).map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_node(conn: &Connection, refr: &str) -> Result<Vec<Symbol>, String> {
    let sql = if refr.contains("::") {
        format!("SELECT {SYM_COLS} FROM cm_symbols WHERE id = ?1")
    } else {
        format!("SELECT {SYM_COLS} FROM cm_symbols WHERE name = ?1 ORDER BY file, line")
    };
    let mut stmt = conn.prepare(&sql).map_err(estr)?;
    let rows = stmt.query_map([refr], row_to_symbol).map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_file_symbols(conn: &Connection, file: &str) -> Result<Vec<Symbol>, String> {
    let sql = format!("SELECT {SYM_COLS} FROM cm_symbols WHERE file = ?1 ORDER BY line");
    let mut stmt = conn.prepare(&sql).map_err(estr)?;
    let rows = stmt.query_map([file], row_to_symbol).map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_context(conn: &Connection, name: &str, limit: u32) -> Result<ContextBundle, String> {
    let mut seeds = q_node(conn, name)?;
    if seeds.is_empty() {
        seeds = q_search(conn, name, limit)?;
    }
    let mut callers = q_callers(conn, name)?;
    let mut callees = q_callees(conn, name)?;
    seeds.truncate(limit as usize);
    callers.truncate(limit as usize);
    callees.truncate(limit as usize);
    Ok(ContextBundle {
        seeds,
        callers,
        callees,
    })
}

fn q_impact(conn: &Connection, name: &str, limit: u32) -> Result<Vec<Symbol>, String> {
    let sql = "
        WITH RECURSIVE impacted(name) AS (
            SELECT ?1
            UNION
            SELECT s.name
              FROM impacted im
              JOIN cm_calls c ON c.name = im.name
              JOIN cm_symbols s ON s.id = c.caller_id
        )
        SELECT DISTINCT sy.id, sy.file, sy.name, sy.kind, sy.line, sy.sig
          FROM impacted im JOIN cm_symbols sy ON sy.name = im.name
          WHERE im.name != ?1
          ORDER BY sy.name LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt
        .query_map(params![name, limit], row_to_symbol)
        .map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_trace(conn: &Connection, from: &str, to: &str, max_depth: u32) -> Result<Vec<String>, String> {
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, u32)> = VecDeque::new();
    queue.push_back((from.to_string(), 0));
    visited.insert(from.to_string());
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT c.name FROM cm_symbols caller \
             JOIN cm_calls c ON c.caller_id = caller.id WHERE caller.name = ?1",
        )
        .map_err(estr)?;
    while let Some((cur, depth)) = queue.pop_front() {
        if cur == to {
            let mut path = vec![cur.clone()];
            let mut node = cur;
            while let Some(p) = parent.get(&node) {
                path.push(p.clone());
                node = p.clone();
            }
            path.reverse();
            return Ok(path);
        }
        if depth >= max_depth {
            continue;
        }
        let callees: Vec<String> = stmt
            .query_map([cur.as_str()], |r| r.get::<_, String>(0))
            .map_err(estr)?
            .filter_map(Result::ok)
            .collect();
        for callee in callees {
            if visited.insert(callee.clone()) {
                parent.insert(callee.clone(), cur.clone());
                queue.push_back((callee, depth + 1));
            }
        }
    }
    Ok(vec![])
}

// ---------------------------------------------------------------------------
// New queries: references, dead, importers, hierarchy, diff_impact, xlang
// ---------------------------------------------------------------------------

fn q_references(conn: &Connection, query: &str, limit: u32) -> Result<Vec<StringRef>, String> {
    let escaped = query
        .replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_");
    let sql = "SELECT file, line, value FROM cm_strings WHERE value LIKE ?1 ESCAPE '\\' ORDER BY file, line LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt
        .query_map(params![format!("%{escaped}%"), limit], |r| {
            Ok(StringRef {
                file: r.get(0)?,
                line: r.get(1)?,
                value: r.get(2)?,
            })
        })
        .map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Entry-point files whose top-level calls are expected and not "dead".
const ENTRY_FILES: &[&str] = &[
    "main.ts", "index.ts", "App.tsx", "app.tsx", "lib.rs", "main.rs",
];

fn q_dead(conn: &Connection, limit: u32) -> Result<Vec<Symbol>, String> {
    // Symbols that are never called AND not exported (sig lacks leading
    // export/pub keyword). Uses prefix matching ('export%' / 'pub %') so
    // a function named `exportData()` is NOT falsely treated as exported.
    //
    // Known limitation: deadness is checked by NAME, not by (file, name).
    // If `foo` in file A is never called but `foo` in file B IS called,
    // the dead `foo` in file A is hidden (false negative). This is a
    // trade-off of the regex-based approach — the cm_calls table stores
    // call targets by name, not by definition site.
    let sql = format!(
        "SELECT {SYM_COLS} FROM cm_symbols s \
         WHERE (s.kind = 'function' OR s.kind = 'method') \
           AND NOT EXISTS (SELECT 1 FROM cm_calls c WHERE c.name = s.name) \
           AND s.sig NOT LIKE 'export%' \
           AND s.sig NOT LIKE 'pub %' \
         ORDER BY s.file, s.line LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql).map_err(estr)?;
    let rows = stmt
        .query_map(params![limit * 3], row_to_symbol)
        .map_err(estr)?;
    let all: Vec<Symbol> = rows.filter_map(Result::ok).collect();
    // Filter out entry-point files.
    Ok(all
        .into_iter()
        .filter(|s| {
            let base = s.file.rsplit(['/', '\\']).next().unwrap_or(&s.file);
            !ENTRY_FILES.contains(&base)
        })
        .take(limit as usize)
        .collect())
}

fn q_importers(conn: &Connection, file: &str, limit: u32) -> Result<Vec<ImportRef>, String> {
    let sql =
        "SELECT file, target, line FROM cm_imports WHERE target = ?1 ORDER BY file, line LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt
        .query_map(params![file, limit], |r| {
            Ok(ImportRef {
                file: r.get(0)?,
                target: r.get(1)?,
                line: r.get(2)?,
            })
        })
        .map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn q_hierarchy(conn: &Connection, name: &str) -> Result<HierarchyBundle, String> {
    let parents_sql =
        "SELECT child, parent, kind, file, line FROM cm_inherits WHERE child = ?1 ORDER BY line";
    let children_sql =
        "SELECT child, parent, kind, file, line FROM cm_inherits WHERE parent = ?1 ORDER BY line";
    let to_ref = |r: &rusqlite::Row| -> rusqlite::Result<InheritRef> {
        Ok(InheritRef {
            child: r.get(0)?,
            parent: r.get(1)?,
            kind: r.get(2)?,
            file: r.get(3)?,
            line: r.get(4)?,
        })
    };
    let mut stmt = conn.prepare(parents_sql).map_err(estr)?;
    let parents: Vec<InheritRef> = stmt
        .query_map([name], to_ref)
        .map_err(estr)?
        .filter_map(Result::ok)
        .collect();
    let mut stmt = conn.prepare(children_sql).map_err(estr)?;
    let children: Vec<InheritRef> = stmt
        .query_map([name], to_ref)
        .map_err(estr)?
        .filter_map(Result::ok)
        .collect();
    Ok(HierarchyBundle { parents, children })
}

fn q_diff_impact(conn: &Connection, files: &[String], limit: u32) -> Result<Vec<Symbol>, String> {
    // Collect all symbols defined in the changed files.
    let mut seeds: Vec<String> = Vec::new();
    {
        let sql = format!("SELECT DISTINCT name FROM cm_symbols WHERE file = ?1");
        let mut stmt = conn.prepare(&sql).map_err(estr)?;
        for f in files {
            let names: Vec<String> = stmt
                .query_map([f.as_str()], |r| r.get::<_, String>(0))
                .map_err(estr)?
                .filter_map(Result::ok)
                .collect();
            seeds.extend(names);
        }
    }
    // For each seed, run transitive impact and collect.
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<Symbol> = Vec::new();
    for name in &seeds {
        let impacted = q_impact(conn, name, limit)?;
        for sym in impacted {
            if seen.insert(sym.id.clone()) {
                result.push(sym);
                if result.len() >= limit as usize {
                    return Ok(result);
                }
            }
        }
    }
    Ok(result)
}

fn q_xlang(conn: &Connection, name: &str) -> Result<Vec<XlangRef>, String> {
    let sql = "SELECT ts_name, rs_name, ts_file, rs_file FROM cm_xlang WHERE ts_name = ?1 OR rs_name = ?1";
    let mut stmt = conn.prepare(sql).map_err(estr)?;
    let rows = stmt
        .query_map([name], |r| {
            Ok(XlangRef {
                ts_name: r.get(0)?,
                rs_name: r.get(1)?,
                ts_file: r.get(2)?,
                rs_file: r.get(3)?,
            })
        })
        .map_err(estr)?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub fn codemap_build(workspace: String) -> Result<BuildStats, String> {
    build(&workspace)
}

#[tauri::command]
pub fn codemap_reindex_file(workspace: String, rel: String) -> Result<(), String> {
    let conn = open(&workspace)?;
    let tx = conn.unchecked_transaction().map_err(estr)?;
    index_file(&conn, &workspace, &rel)?;
    tx.commit().map_err(estr)
}

#[tauri::command]
pub fn codemap_reindex_files(workspace: String, rels: Vec<String>) -> Result<(), String> {
    let conn = open(&workspace)?;
    let tx = conn.unchecked_transaction().map_err(estr)?;
    for rel in &rels {
        let _ = index_file(&conn, &workspace, rel);
    }
    tx.commit().map_err(estr)
}

#[tauri::command]
pub fn codemap_search(
    workspace: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_search(&conn, &query, limit.unwrap_or(25))
}

#[tauri::command]
pub fn codemap_callers(workspace: String, name: String) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_callers(&conn, &name)
}

#[tauri::command]
pub fn codemap_callees(workspace: String, name: String) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_callees(&conn, &name)
}

#[tauri::command]
pub fn codemap_node(workspace: String, reference: String) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_node(&conn, &reference)
}

#[tauri::command]
pub fn codemap_file_symbols(workspace: String, file: String) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_file_symbols(&conn, &file)
}

#[tauri::command]
pub fn codemap_impact(
    workspace: String,
    name: String,
    limit: Option<u32>,
) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_impact(&conn, &name, limit.unwrap_or(50))
}

#[tauri::command]
pub fn codemap_trace(
    workspace: String,
    from: String,
    to: String,
    max_depth: Option<u32>,
) -> Result<Vec<String>, String> {
    let conn = open(&workspace)?;
    q_trace(&conn, &from, &to, max_depth.unwrap_or(12))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ContextBundle {
    pub seeds: Vec<Symbol>,
    pub callers: Vec<Symbol>,
    pub callees: Vec<Symbol>,
}

#[tauri::command]
pub fn codemap_context(
    workspace: String,
    name: String,
    limit: Option<u32>,
) -> Result<ContextBundle, String> {
    let conn = open(&workspace)?;
    q_context(&conn, &name, limit.unwrap_or(25))
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct CodeMapStatus {
    pub files: i64,
    pub symbols: i64,
    pub calls: i64,
}

#[tauri::command]
pub fn codemap_status(workspace: String) -> Result<CodeMapStatus, String> {
    let conn = open(&workspace)?;
    let count = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0))
            .map_err(estr)
    };
    Ok(CodeMapStatus {
        files: count("SELECT COUNT(*) FROM cm_files")?,
        symbols: count("SELECT COUNT(*) FROM cm_symbols")?,
        calls: count("SELECT COUNT(*) FROM cm_calls")?,
    })
}

#[tauri::command]
pub fn codemap_references(
    workspace: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<StringRef>, String> {
    let conn = open(&workspace)?;
    q_references(&conn, &query, limit.unwrap_or(50))
}

#[tauri::command]
pub fn codemap_dead(workspace: String, limit: Option<u32>) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_dead(&conn, limit.unwrap_or(50))
}

/// Generate candidate import specifiers for a file path so that both
/// `src/lib/compact.ts` and `@/lib/compact` resolve to the same targets.
fn import_candidates(file: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![file.to_string()];
    // Strip common extensions.
    let no_ext = file
        .strip_suffix(".ts")
        .or_else(|| file.strip_suffix(".tsx"))
        .or_else(|| file.strip_suffix(".js"))
        .or_else(|| file.strip_suffix(".jsx"))
        .unwrap_or(file);
    if no_ext != file {
        out.push(no_ext.to_string());
    }
    // src/lib/foo → @/lib/foo
    if let Some(rest) = no_ext.strip_prefix("src/") {
        let alias = format!("@/{rest}");
        if !out.contains(&alias) {
            out.push(alias);
        }
    }
    // @/lib/foo → src/lib/foo
    if let Some(rest) = no_ext.strip_prefix("@/") {
        let src = format!("src/{rest}");
        if !out.contains(&src) {
            out.push(src);
        }
    }
    out
}

#[tauri::command]
pub fn codemap_importers(
    workspace: String,
    file: String,
    limit: Option<u32>,
) -> Result<Vec<ImportRef>, String> {
    let conn = open(&workspace)?;
    let lim = limit.unwrap_or(50);
    let candidates = import_candidates(&file);
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<ImportRef> = Vec::new();
    for c in &candidates {
        for r in q_importers(&conn, c, lim)? {
            let key = format!("{}:{}:{}", r.file, r.target, r.line);
            if seen.insert(key) {
                result.push(r);
                if result.len() >= lim as usize {
                    return Ok(result);
                }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn codemap_hierarchy(workspace: String, name: String) -> Result<HierarchyBundle, String> {
    let conn = open(&workspace)?;
    q_hierarchy(&conn, &name)
}

#[tauri::command]
pub fn codemap_diff_impact(
    workspace: String,
    files: Vec<String>,
    limit: Option<u32>,
) -> Result<Vec<Symbol>, String> {
    let conn = open(&workspace)?;
    q_diff_impact(&conn, &files, limit.unwrap_or(50))
}

#[tauri::command]
pub fn codemap_xlang(workspace: String, name: String) -> Result<Vec<XlangRef>, String> {
    let conn = open(&workspace)?;
    q_xlang(&conn, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns_compile() {
        assert!(!PATTERNS.is_empty());
        assert!(CALL_SITE_RE.is_match("foo("));
    }

    #[test]
    fn ts_symbols_and_calls() {
        let src = "export function greet(name) {\n  return format(name)\n}\n";
        let pf = parse_source("a.ts", src, "ts");
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "greet" && s.kind == "function"));
        assert!(pf.raw_calls.iter().any(|c| c.name == "format"));
        assert!(!pf.raw_calls.iter().any(|c| c.name == "greet"));
    }

    #[test]
    fn rust_fn_and_struct() {
        let src = "pub fn run() {}\nstruct Foo { x: i32 }\n";
        let pf = parse_source("a.rs", src, "rs");
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "run" && s.kind == "function"));
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "Foo" && s.kind == "struct"));
    }

    #[test]
    fn go_type_alias_vs_struct() {
        let src = "type Foo struct {\n}\ntype Bar int\n";
        let pf = parse_source("a.go", src, "go");
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "Foo" && s.kind == "struct"));
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "Bar" && s.kind == "type"));
        // Foo, type-alias OLARAK eklenmemeli (lookahead workaround).
        assert!(!pf
            .symbols
            .iter()
            .any(|s| s.name == "Foo" && s.kind == "type"));
    }

    #[test]
    fn owner_by_line_tracks_symbol() {
        let src = "function a() {\n  x()\n}\nfunction b() {\n  y()\n}\n";
        let pf = parse_source("a.ts", src, "ts");
        let a_id = pf
            .symbols
            .iter()
            .find(|s| s.name == "a")
            .unwrap()
            .id
            .clone();
        let b_id = pf
            .symbols
            .iter()
            .find(|s| s.name == "b")
            .unwrap()
            .id
            .clone();
        assert_eq!(pf.owner_by_line[2], a_id);
        assert_eq!(pf.owner_by_line[5], b_id);
    }

    #[test]
    fn owner_by_line_top_level_after_fn_is_unowned() {
        let src = "function a() {\n  x()\n}\ntopLevel()\nfunction b() {\n  y()\n}\n";
        let pf = parse_source("a.ts", src, "ts");
        let a_id = pf
            .symbols
            .iter()
            .find(|s| s.name == "a")
            .unwrap()
            .id
            .clone();
        assert_eq!(pf.owner_by_line[2], a_id);
        assert_eq!(pf.owner_by_line[4], ""); // topLevel() — sahipsiz
        assert!(pf
            .raw_calls
            .iter()
            .any(|c| c.name == "topLevel" && pf.owner_by_line[c.line as usize].is_empty()));
    }

    #[test]
    fn owner_by_line_brace_in_string_does_not_truncate() {
        let src = "function a() {\n  let s = \"}\";\n  x()\n}\n";
        let pf = parse_source("a.ts", src, "ts");
        let a_id = pf
            .symbols
            .iter()
            .find(|s| s.name == "a")
            .unwrap()
            .id
            .clone();
        assert_eq!(pf.owner_by_line[2], a_id);
        assert_eq!(pf.owner_by_line[3], a_id);
    }

    #[test]
    fn store_and_query_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let pf = parse_source("a.ts", "function a() {\n  b()\n}\nfunction b() {}\n", "ts");
        store_file(&conn, "a.ts", &pf, "h1").unwrap();
        let syms: i64 = conn
            .query_row("SELECT COUNT(*) FROM cm_symbols", [], |r| r.get(0))
            .unwrap();
        assert_eq!(syms, 2); // a, b
        let calls: i64 = conn
            .query_row("SELECT COUNT(*) FROM cm_calls WHERE name = 'b'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(calls, 1);
    }

    #[test]
    fn store_file_is_incremental() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source("a.ts", "function x() {}\n", "ts"),
            "h1",
        )
        .unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source("a.ts", "function y() {}\n", "ts"),
            "h2",
        )
        .unwrap();
        let names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM cm_symbols WHERE file = 'a.ts'")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert_eq!(names, vec!["y".to_string()]);
    }

    #[test]
    fn callers_callees_via_join() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source("a.ts", "function a() {\n  b()\n}\n", "ts"),
            "h",
        )
        .unwrap();
        store_file(
            &conn,
            "b.ts",
            &parse_source("b.ts", "function b() {}\nfunction c() {\n  b()\n}\n", "ts"),
            "h",
        )
        .unwrap();
        let callers: HashSet<String> = q_callers(&conn, "b")
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(callers.contains("a") && callers.contains("c"));
        assert!(q_callees(&conn, "a").unwrap().iter().any(|s| s.name == "b"));
        assert!(!q_search(&conn, "b", 10).unwrap().is_empty());
        assert!(q_node(&conn, "b")
            .unwrap()
            .iter()
            .any(|s| s.kind == "function"));
    }

    #[test]
    fn impact_transitive_callers() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "f.ts",
            &parse_source(
                "f.ts",
                "function a() {}\nfunction b() {\n  a()\n}\nfunction c() {\n  b()\n}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        let imp: HashSet<String> = q_impact(&conn, "a", 50)
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(imp.contains("b") && imp.contains("c"));
    }

    #[test]
    fn trace_finds_path() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "f.ts",
            &parse_source(
                "f.ts",
                "function a() {\n  b()\n}\nfunction b() {\n  c()\n}\nfunction c() {}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        assert_eq!(q_trace(&conn, "a", "c", 12).unwrap(), vec!["a", "b", "c"]);
        assert!(q_trace(&conn, "c", "a", 12).unwrap().is_empty());
    }

    #[test]
    fn html_inline_js_indexed() {
        assert_eq!(ext_to_lang(".html"), Some("ts"));
        let src = "<html>\n<body><canvas id=c></canvas>\n<script>\nfunction update() {\n  draw()\n}\nfunction draw() {}\n</script>\n</body>\n</html>\n";
        let pf = parse_source("game.html", src, "ts");
        assert!(pf
            .symbols
            .iter()
            .any(|s| s.name == "update" && s.kind == "function"));
        assert!(pf.symbols.iter().any(|s| s.name == "draw"));
        assert!(!pf
            .symbols
            .iter()
            .any(|s| s.name == "canvas" || s.name == "body"));
    }

    #[test]
    fn index_file_rejects_unsafe_paths() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // `..` segment + absolute (unix/windows) → guard reddeder (fs'e dokunmadan).
        for bad in [
            "../secret.ts",
            "a/../../b.ts",
            "/etc/passwd.ts",
            "\\\\srv\\x.ts",
        ] {
            assert!(
                index_file(&conn, "/tmp/ws", bad).is_err(),
                "reddetmeli: {bad}"
            );
        }
        assert!(index_file(&conn, "/nonexistent-ws", "src/a.ts").is_ok());
    }

    #[test]
    fn q_search_escapes_like_wildcards() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let pf = parse_source(
            "a.ts",
            "function foo_bar() {}\nfunction fooXbar() {}\n",
            "ts",
        );
        store_file(&conn, "a.ts", &pf, "h").unwrap();
        let names: HashSet<String> = q_search(&conn, "foo_bar", 10)
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(names.contains("foo_bar"));
        assert!(!names.contains("fooXbar"));
    }

    #[test]
    fn q_context_bundles_definition_callers_callees() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "f.ts",
            &parse_source(
                "f.ts",
                "function a() {\n  b()\n}\nfunction b() {\n  c()\n}\nfunction c() {}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        let ctx = q_context(&conn, "b", 25).unwrap();
        assert!(ctx.seeds.iter().any(|s| s.name == "b"));
        assert!(ctx.callers.iter().any(|s| s.name == "a"));
        assert!(ctx.callees.iter().any(|s| s.name == "c"));
    }

    // --- New feature tests ---

    #[test]
    fn string_extraction_finds_literals() {
        let src = r#"const x = "hello world"; const y = 'ab'; const z = "ok";"#;
        let pf = parse_source("a.ts", src, "ts");
        let vals: Vec<&str> = pf.strings.iter().map(|(v, _)| v.as_str()).collect();
        assert!(vals.contains(&"hello world"));
        // "ab" is only 2 chars — below MIN_STRING_LEN
        assert!(!vals.contains(&"ab"));
        // "ok" is only 2 chars — below MIN_STRING_LEN
        assert!(!vals.contains(&"ok"));
    }

    #[test]
    fn q_references_finds_string_in_db() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let src = r#"function a() { return "semantic.index" }"#;
        store_file(&conn, "a.ts", &parse_source("a.ts", src, "ts"), "h").unwrap();
        let refs = q_references(&conn, "semantic", 10).unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file, "a.ts");
        assert!(refs[0].value.contains("semantic"));
    }

    #[test]
    fn import_extraction_ts() {
        let src =
            "import { foo } from './foo'\nimport bar from '../bar'\nconst x = require('./baz')\n";
        let pf = parse_source("a.ts", src, "ts");
        let targets: Vec<&str> = pf.imports.iter().map(|(t, _)| t.as_str()).collect();
        assert!(targets.contains(&"./foo"));
        assert!(targets.contains(&"../bar"));
        assert!(targets.contains(&"./baz"));
    }

    #[test]
    fn import_extraction_rs() {
        let src = "use crate::foo::bar;\nmod baz;\npub use std::io;\n";
        let pf = parse_source("a.rs", src, "rs");
        let targets: Vec<&str> = pf.imports.iter().map(|(t, _)| t.as_str()).collect();
        assert!(targets.contains(&"foo::bar"));
        assert!(targets.contains(&"baz"));
        assert!(targets.contains(&"std::io"));
    }

    #[test]
    fn q_importers_finds_dependents() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source("a.ts", "import { x } from './utils'\n", "ts"),
            "h",
        )
        .unwrap();
        store_file(
            &conn,
            "b.ts",
            &parse_source("b.ts", "import { y } from './utils'\n", "ts"),
            "h",
        )
        .unwrap();
        let importers = q_importers(&conn, "./utils", 10).unwrap();
        assert_eq!(importers.len(), 2);
    }

    #[test]
    fn inherits_extraction_ts() {
        let src = "class Dog extends Animal implements Pet, Trainable {\n}\n";
        let pf = parse_source("a.ts", src, "ts");
        assert!(pf
            .inherits
            .iter()
            .any(|(c, p, k, _)| c == "Dog" && p == "Animal" && k == "extends"));
        assert!(pf
            .inherits
            .iter()
            .any(|(c, p, k, _)| c == "Dog" && p == "Pet" && k == "implements"));
        assert!(pf
            .inherits
            .iter()
            .any(|(c, p, k, _)| c == "Dog" && p == "Trainable" && k == "implements"));
    }

    #[test]
    fn inherits_extraction_rs() {
        let src = "impl Display for Foo {\n}\nimpl Clone for Bar {\n}\n";
        let pf = parse_source("a.rs", src, "rs");
        assert!(pf
            .inherits
            .iter()
            .any(|(c, p, k, _)| c == "Foo" && p == "Display" && k == "impl_trait"));
        assert!(pf
            .inherits
            .iter()
            .any(|(c, p, k, _)| c == "Bar" && p == "Clone" && k == "impl_trait"));
    }

    #[test]
    fn q_hierarchy_parents_and_children() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source(
                "a.ts",
                "class Dog extends Animal {}\nclass Cat extends Animal {}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        let h = q_hierarchy(&conn, "Animal").unwrap();
        assert_eq!(h.children.len(), 2);
        assert!(h.parents.is_empty());
        let h2 = q_hierarchy(&conn, "Dog").unwrap();
        assert_eq!(h2.parents.len(), 1);
        assert_eq!(h2.parents[0].parent, "Animal");
    }

    #[test]
    fn dead_symbols_detected() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // helper is called, orphan is not.
        store_file(
            &conn,
            "a.ts",
            &parse_source(
                "a.ts",
                "function helper() {}\nfunction orphan() {}\nfunction main() {\n  helper()\n}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        let dead = q_dead(&conn, 50).unwrap();
        let names: Vec<&str> = dead.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"orphan"));
        assert!(!names.contains(&"helper"));
    }

    #[test]
    fn dead_symbols_skips_exported() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source(
                "a.ts",
                "export function publicApi() {}\nfunction internal() {}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        let dead = q_dead(&conn, 50).unwrap();
        let names: Vec<&str> = dead.iter().map(|s| s.name.as_str()).collect();
        assert!(!names.contains(&"publicApi"));
        assert!(names.contains(&"internal"));
    }

    #[test]
    fn dead_symbols_export_named_fn_not_excluded() {
        // A function named `exportData` must NOT be falsely treated as
        // exported — the old '%export%' pattern matched the function name.
        // The prefix match 'export%' only matches sigs starting with the
        // `export` keyword.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source("a.ts", "function exportData() {}\n", "ts"),
            "h",
        )
        .unwrap();
        let dead = q_dead(&conn, 50).unwrap();
        let names: Vec<&str> = dead.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"exportData"));
    }

    #[test]
    fn tauri_command_and_invoke_extraction() {
        let rs_src =
            "#[tauri::command]\npub fn pty_spawn() {}\n#[tauri::command]\nfn read_env_var() {}\n";
        let pf_rs = parse_source("lib.rs", rs_src, "rs");
        assert!(pf_rs.tauri_commands.contains(&"pty_spawn".to_string()));
        assert!(pf_rs.tauri_commands.contains(&"read_env_var".to_string()));

        let ts_src = r#"const r = await invoke<string>("pty_spawn", { args })"#;
        let pf_ts = parse_source("a.ts", ts_src, "ts");
        assert!(pf_ts.invoke_calls.iter().any(|(n, _)| n == "pty_spawn"));
    }

    #[test]
    fn q_xlang_matches_invoke_to_command() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO cm_xlang (ts_name, rs_name, ts_file, rs_file) VALUES ('pty_spawn', 'pty_spawn', 'src/a.ts', 'src-tauri/src/lib.rs')",
            [],
        )
        .unwrap();
        let refs = q_xlang(&conn, "pty_spawn").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].ts_file, "src/a.ts");
        assert_eq!(refs[0].rs_file, "src-tauri/src/lib.rs");
    }

    #[test]
    fn q_diff_impact_finds_transitive_callers() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        store_file(
            &conn,
            "a.ts",
            &parse_source(
                "a.ts",
                "function changed() {}\nfunction mid() {\n  changed()\n}\n",
                "ts",
            ),
            "h",
        )
        .unwrap();
        store_file(
            &conn,
            "b.ts",
            &parse_source("b.ts", "function top() {\n  mid()\n}\n", "ts"),
            "h",
        )
        .unwrap();
        let impact = q_diff_impact(&conn, &["a.ts".to_string()], 50).unwrap();
        let names: HashSet<String> = impact.iter().map(|s| s.name.clone()).collect();
        assert!(names.contains("mid"));
        assert!(names.contains("top"));
    }
}
