// Frontend (src/lib/db/driver.tauri.ts) buradaki db_execute/db_select/db_batch
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

#[derive(Deserialize)]
pub struct BatchStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::from(String::from_utf8_lossy(b).into_owned()),
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn db_execute(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(err)?;
    let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
    conn.execute(&sql, rusqlite::params_from_iter(p.iter()))
        .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn db_select(
    state: State<DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(p.iter()), |row| {
            let mut obj = Map::new();
            for (i, name) in cols.iter().enumerate() {
                obj.insert(name.clone(), from_sql(row.get_ref(i)?));
            }
            Ok(obj)
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_batch(state: State<DbState>, statements: Vec<BatchStatement>) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for s in &statements {
        let p: Vec<SqlValue> = s.params.iter().map(to_sql).collect();
        tx.execute(&s.sql, rusqlite::params_from_iter(p.iter()))
            .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

fn to_file_uri(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    if !p.starts_with('/') {
        p = format!("/{p}");
    }
    let enc: String = p
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '?' => "%3f".to_string(),
            '#' => "%23".to_string(),
            '%' => "%25".to_string(),
            _ => c.to_string(),
        })
        .collect();
    format!("file:{enc}?immutable=1")
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let h = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let h = std::env::var_os("HOME");
    h.map(PathBuf::from)
}

#[tauri::command]
pub fn db_select_external(
    path: String,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    use rusqlite::OpenFlags;

    // Arbitrary-path guard: this command opens a SQLite file and runs SELECTs on
    // it. Without containment it is a machine-wide read primitive (any SQLite DB
    // on disk — browser profiles, other apps' data). Legit callers only read the
    // user's own history DBs under the home dir, so restrict + canonicalize:
    // canonicalize() also resolves symlinks, so a symlink pointing outside home
    // is rejected even when the lexical path looks benign.
    let home = home_dir().ok_or_else(|| "db_select_external: home dir bulunamadı".to_string())?;
    let home_canon = std::fs::canonicalize(&home).map_err(err)?;
    let target = std::fs::canonicalize(&path)
        .map_err(|e| format!("db_select_external: path doğrulanamadı: {e}"))?;
    if !target.starts_with(&home_canon) {
        return Err("db_select_external: path home dizini dışında — erişim reddedildi".to_string());
    }

    // SELECT-only + no database-switching / pragma keywords. ATTACH could open
    // arbitrary files even from a readonly connection; PRAGMA/VACUUM mutate.
    let up = sql.to_ascii_uppercase();
    let tokens: Vec<&str> = up
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.first().map(|s| *s) != Some("SELECT") {
        return Err("db_select_external: only SELECT allowed".to_string());
    }
    if tokens
        .iter()
        .any(|t| ["ATTACH", "DETACH", "PRAGMA", "VACUUM"].contains(t))
    {
        return Err("db_select_external: ATTACH/PRAGMA/VACUUM/DETACH yasak".to_string());
    }

    let ro = OpenFlags::SQLITE_OPEN_READ_ONLY;
    let ro_uri = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI;
    let conn = Connection::open_with_flags(&target, ro)
        .or_else(|_| Connection::open_with_flags(to_file_uri(&target.to_string_lossy()), ro_uri))
        .map_err(err)?;
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(err)?;
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(p.iter()), |row| {
            let mut obj = Map::new();
            for (i, name) in cols.iter().enumerate() {
                obj.insert(name.clone(), from_sql(row.get_ref(i)?));
            }
            Ok(obj)
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

pub fn open(path: PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(err)?;
    Ok(conn)
}
