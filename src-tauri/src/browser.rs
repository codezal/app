//
//   browser_navigate → browser_screenshot (base64 PNG) → tool sonucu → vision model.
//
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption;
use headless_chrome::{Browser, LaunchOptions, Tab};
use tauri::State;

const CONSOLE_HOOK_JS: &str = r#"(function(){
  if (window.__codezalHooked) return;
  window.__codezalHooked = true;
  window.__codezalLogs = [];
  var push = function(level, args){
    try {
      window.__codezalLogs.push("[" + level + "] " + Array.prototype.map.call(args, String).join(" "));
      if (window.__codezalLogs.length > 200) window.__codezalLogs.shift();
    } catch (e) {}
  };
  ["log","info","warn","error","debug"].forEach(function(l){
    var orig = console[l];
    console[l] = function(){ push(l, arguments); return orig.apply(console, arguments); };
  });
  window.addEventListener("error", function(e){ push("error", [e.message]); });
  window.addEventListener("unhandledrejection", function(e){ push("error", ["[unhandled] " + e.reason]); });
})();"#;

const NETWORK_HOOK_JS: &str = r#"(function(){
  if (window.__codezalNetHooked) return;
  window.__codezalNetHooked = true;
  window.__codezalNet = [];
  var push = function(s){
    try {
      window.__codezalNet.push(s);
      if (window.__codezalNet.length > 100) window.__codezalNet.shift();
    } catch (e) {}
  };
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(){
      var a = arguments;
      var url = (a[0] && a[0].url) ? a[0].url : String(a[0] || "");
      var method = (a[1] && a[1].method) || (a[0] && a[0].method) || "GET";
      var t0 = Date.now();
      return origFetch.apply(this, a).then(function(res){
        push("[" + method + "] " + res.status + " " + url + " (" + (Date.now() - t0) + "ms)");
        return res;
      }, function(err){
        push("[" + method + "] ERR " + url + " (" + (Date.now() - t0) + "ms) " + String(err));
        throw err;
      });
    };
  }
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var open = XHR.prototype.open, send = XHR.prototype.send;
    XHR.prototype.open = function(m, u){ this.__cz = { m: m, u: u, t0: 0 }; return open.apply(this, arguments); };
    XHR.prototype.send = function(){
      var x = this;
      if (x.__cz) {
        x.__cz.t0 = Date.now();
        x.addEventListener("loadend", function(){
          try { push("[" + x.__cz.m + "] " + x.status + " " + x.__cz.u + " (" + (Date.now() - x.__cz.t0) + "ms)"); } catch (e) {}
        });
      }
      return send.apply(this, arguments);
    };
  }
})();"#;

const SNAPSHOT_JS: &str = r#"(function(){
  try {
    document.querySelectorAll('[data-cz-ref]').forEach(function(e){ e.removeAttribute('data-cz-ref'); });
    var sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[role=switch],[role=radio],[onclick],[contenteditable=true],summary,label';
    var out = [], n = 0;
    function vis(el){ var r = el.getBoundingClientRect(); if (r.width<=0 || r.height<=0) return false; var s = getComputedStyle(el); return s.visibility!=='hidden' && s.display!=='none' && s.opacity!=='0'; }
    function nm(el){ var tag=el.tagName; var t=(el.getAttribute('aria-label')||el.getAttribute('placeholder')||((tag==='INPUT'||tag==='TEXTAREA')?'':el.innerText)||el.value||el.getAttribute('title')||el.getAttribute('name')||el.getAttribute('alt')||'').trim().replace(/\s+/g,' '); return t.slice(0,80); }
    document.querySelectorAll(sel).forEach(function(el){
      if (!vis(el)) return;
      n++; el.setAttribute('data-cz-ref', String(n));
      var role = el.getAttribute('role') || el.tagName.toLowerCase();
      var line = '['+n+'] '+role+' '+JSON.stringify(nm(el));
      var tag = el.tagName;
      if (tag==='INPUT' || tag==='TEXTAREA') { line += ' value='+JSON.stringify(String(el.value||'').slice(0,40)); if (el.type) line += ' type='+el.type; }
      if (tag==='SELECT') line += ' selected='+JSON.stringify(String(el.value||''));
      if (tag==='A' && el.getAttribute('href')) line += ' href='+JSON.stringify(el.getAttribute('href').slice(0,80));
      if (el.disabled) line += ' (disabled)';
      out.push(line);
    });
    return JSON.stringify({ title: document.title, url: location.href, count: n, elements: out });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavResult {
    final_url: String,
    title: String,
}

fn is_blocked_host(url: &str) -> bool {
    let after = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let authority = after.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(rest) = hostport.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        hostport.split(':').next().unwrap_or("")
    };
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    if h == "metadata.google.internal" || h == "metadata.goog" {
        return true;
    }
    // IP'yi normalize edip denetle: dotted v4/v6, IPv4-mapped IPv6 ([::ffff:169.254.169.254])
    host_is_blocked_ip(&h)
}

fn host_is_blocked_ip(h: &str) -> bool {
    use std::net::IpAddr;
    if let Ok(ip) = h.parse::<IpAddr>() {
        return ip_blocked(ip);
    }
    if let Some(v4) = parse_numeric_ipv4(h) {
        return ip_blocked(IpAddr::V4(v4));
    }
    false
}

fn ip_blocked(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4() {
                return is_blocked_v4(v4);
            }
            let seg = v6.segments();
            // AWS IMDS IPv6 fd00:ec2::/32 + genel link-local fe80::/10.
            (seg[0] == 0xfd00 && seg[1] == 0x0ec2) || (seg[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_blocked_v4(v4: std::net::Ipv4Addr) -> bool {
    let o = v4.octets();
    o[0] == 169 && o[1] == 254
}

fn parse_numeric_ipv4(h: &str) -> Option<std::net::Ipv4Addr> {
    let parts: Vec<&str> = h.split('.').collect();
    if parts.is_empty() || parts.len() > 4 {
        return None;
    }
    let mut nums = Vec::with_capacity(parts.len());
    for p in &parts {
        nums.push(parse_radix_u32(p)?);
    }
    let value: u32 = match nums.len() {
        1 => nums[0],
        2 => {
            if nums[0] > 0xff || nums[1] > 0x00ff_ffff {
                return None;
            }
            (nums[0] << 24) | nums[1]
        }
        3 => {
            if nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff {
                return None;
            }
            (nums[0] << 24) | (nums[1] << 16) | nums[2]
        }
        4 => {
            if nums.iter().any(|&x| x > 0xff) {
                return None;
            }
            (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]
        }
        _ => return None,
    };
    Some(std::net::Ipv4Addr::from(value))
}

fn parse_radix_u32(s: &str) -> Option<u32> {
    if s.is_empty() {
        return None;
    }
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        u32::from_str_radix(hex, 16).ok()
    } else if s.len() > 1 && s.starts_with('0') {
        u32::from_str_radix(&s[1..], 8).ok()
    } else {
        s.parse::<u32>().ok()
    }
}

fn ref_selector(target: &str) -> String {
    if !target.is_empty() && target.chars().all(|c| c.is_ascii_digit()) {
        format!("[data-cz-ref=\"{target}\"]")
    } else {
        target.to_string()
    }
}

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

#[derive(Default)]
struct Inner {
    browser: Mutex<Option<Browser>>,
    tabs: Mutex<HashMap<String, Arc<Tab>>>,
}

impl Inner {
    fn ensure_browser(&self) -> Result<(), String> {
        let mut guard = self.browser.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let opts = LaunchOptions::default_builder()
                .headless(true)
                .idle_browser_timeout(std::time::Duration::from_secs(3600))
                .build()
                .map_err(|e| format!("Chrome başlatma seçenekleri kurulamadı: {e}"))?;
            let browser = Browser::new(opts)
                .map_err(|e| format!("Chrome/Edge bulunamadı veya başlatılamadı: {e}"))?;
            *guard = Some(browser);
        }
        Ok(())
    }

    fn tab_for(&self, session_id: &str) -> Result<Arc<Tab>, String> {
        self.ensure_browser()?;
        let mut tabs = self.tabs.lock().map_err(|e| e.to_string())?;
        if let Some(t) = tabs.get(session_id) {
            return Ok(t.clone());
        }
        let new_tab = {
            let guard = self.browser.lock().map_err(|e| e.to_string())?;
            let browser = guard.as_ref().ok_or_else(|| "browser yok".to_string())?;
            browser.new_tab()
        };
        match new_tab {
            Ok(tab) => {
                tabs.insert(session_id.to_string(), tab.clone());
                Ok(tab)
            }
            Err(e) => {
                if let Ok(mut b) = self.browser.lock() {
                    *b = None;
                }
                Err(e.to_string())
            }
        }
    }

    fn evict(&self, session_id: &str) {
        if let Ok(mut tabs) = self.tabs.lock() {
            tabs.remove(session_id);
        }
    }

    fn act_js(&self, session_id: &str, js: &str, target: &str) -> Result<(), String> {
        let tab = self.tab_for(session_id)?;
        match tab.evaluate(js, false) {
            Ok(o) => {
                let v = o
                    .value
                    .and_then(|x| x.as_str().map(|s| s.to_string()))
                    .unwrap_or_default();
                if v == "NOTFOUND" {
                    Err(format!(
                        "Element bulunamadı: {target} (önce browser_snapshot ile taze ref al)"
                    ))
                } else {
                    Ok(())
                }
            }
            Err(e) => {
                self.evict(session_id);
                Err(e.to_string())
            }
        }
    }

    fn navigate(&self, session_id: &str, url: &str) -> Result<NavResult, String> {
        if is_blocked_host(url) {
            return Err(
                "Bu host engellendi (cloud metadata / link-local — SSRF koruması).".to_string(),
            );
        }
        let tab = self.tab_for(session_id)?;
        let res = (|| -> Result<NavResult, String> {
            tab.navigate_to(url).map_err(|e| e.to_string())?;
            tab.wait_until_navigated().map_err(|e| e.to_string())?;
            let _ = tab.evaluate(CONSOLE_HOOK_JS, false);
            let _ = tab.evaluate(NETWORK_HOOK_JS, false);
            Ok(NavResult {
                final_url: tab.get_url(),
                title: tab.get_title().unwrap_or_default(),
            })
        })();
        if res.is_err() {
            self.evict(session_id);
        }
        res
    }

    fn screenshot(&self, session_id: &str) -> Result<String, String> {
        let tab = self.tab_for(session_id)?;
        match tab.capture_screenshot(CaptureScreenshotFormatOption::Jpeg, Some(70), None, true) {
            Ok(bytes) => Ok(base64::engine::general_purpose::STANDARD.encode(bytes)),
            Err(e) => {
                self.evict(session_id);
                Err(e.to_string())
            }
        }
    }

    fn console(&self, session_id: &str) -> Result<Vec<String>, String> {
        let tab = self.tab_for(session_id)?;
        let obj = match tab.evaluate("JSON.stringify(window.__codezalLogs||[])", false) {
            Ok(o) => o,
            Err(e) => {
                self.evict(session_id);
                return Err(e.to_string());
            }
        };
        let json = obj
            .value
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "[]".to_string());
        Ok(serde_json::from_str(&json).unwrap_or_default())
    }

    fn network(&self, session_id: &str) -> Result<Vec<String>, String> {
        let tab = self.tab_for(session_id)?;
        let obj = match tab.evaluate("JSON.stringify(window.__codezalNet||[])", false) {
            Ok(o) => o,
            Err(e) => {
                self.evict(session_id);
                return Err(e.to_string());
            }
        };
        let json = obj
            .value
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "[]".to_string());
        Ok(serde_json::from_str(&json).unwrap_or_default())
    }

    fn close(&self, session_id: &str) -> Result<(), String> {
        let mut tabs = self.tabs.lock().map_err(|e| e.to_string())?;
        if let Some(tab) = tabs.remove(session_id) {
            let _ = tab.close(true);
        }
        Ok(())
    }


    fn snapshot(&self, session_id: &str) -> Result<String, String> {
        let tab = self.tab_for(session_id)?;
        match tab.evaluate(SNAPSHOT_JS, false) {
            Ok(o) => Ok(o
                .value
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "{}".to_string())),
            Err(e) => {
                self.evict(session_id);
                Err(e.to_string())
            }
        }
    }

    fn guard_blocked_url(&self, session_id: &str) -> Result<(), String> {
        if let Ok(tab) = self.tab_for(session_id) {
            if is_blocked_host(&tab.get_url()) {
                let _ = tab.navigate_to("about:blank");
                return Err(
                    "Engellenen host'a yönlendirme tespit edildi (cloud metadata / link-local — SSRF koruması)."
                        .to_string(),
                );
            }
        }
        Ok(())
    }

    fn click(&self, session_id: &str, target: &str) -> Result<(), String> {
        let sel = js_str(&ref_selector(target));
        let js = format!(
            "(function(){{var el=document.querySelector({sel});if(!el)return 'NOTFOUND';el.scrollIntoView({{block:'center'}});el.click();return 'OK';}})()"
        );
        self.act_js(session_id, &js, target)?;
        self.guard_blocked_url(session_id)
    }

    fn fill(&self, session_id: &str, target: &str, text: &str) -> Result<(), String> {
        let sel = js_str(&ref_selector(target));
        let val = js_str(text);
        let js = format!(
            "(function(){{var el=document.querySelector({sel});if(!el)return 'NOTFOUND';el.focus();var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');if(d&&d.set)d.set.call(el,{val});else el.value={val};el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return 'OK';}})()"
        );
        self.act_js(session_id, &js, target)
    }

    fn select(&self, session_id: &str, target: &str, value: &str) -> Result<(), String> {
        let sel = js_str(&ref_selector(target));
        let val = js_str(value);
        let js = format!(
            "(function(){{var el=document.querySelector({sel});if(!el)return 'NOTFOUND';el.value={val};el.dispatchEvent(new Event('change',{{bubbles:true}}));return 'OK';}})()"
        );
        self.act_js(session_id, &js, target)
    }

    fn press(&self, session_id: &str, key: &str) -> Result<(), String> {
        let tab = self.tab_for(session_id)?;
        let r = tab.press_key(key).map(|_| ()).map_err(|e| e.to_string());
        if r.is_err() {
            self.evict(session_id);
        }
        r
    }

    fn type_text(&self, session_id: &str, text: &str) -> Result<(), String> {
        let tab = self.tab_for(session_id)?;
        let r = tab.type_str(text).map(|_| ()).map_err(|e| e.to_string());
        if r.is_err() {
            self.evict(session_id);
        }
        r
    }

    fn scroll(
        &self,
        session_id: &str,
        target: Option<&str>,
        dy: Option<i64>,
    ) -> Result<(), String> {
        let js = match target {
            Some(t) if !t.is_empty() => {
                let sel = js_str(&ref_selector(t));
                format!("(function(){{var el=document.querySelector({sel});if(!el)return 'NOTFOUND';el.scrollIntoView({{block:'center'}});return 'OK';}})()")
            }
            _ => {
                let d = dy.unwrap_or(600);
                format!("(function(){{window.scrollBy({{top:{d},behavior:'instant'}});return 'OK';}})()")
            }
        };
        self.act_js(session_id, &js, target.unwrap_or(""))
    }

    fn hover(&self, session_id: &str, target: &str) -> Result<(), String> {
        let sel = js_str(&ref_selector(target));
        let js = format!(
            "(function(){{var el=document.querySelector({sel});if(!el)return 'NOTFOUND';['mouseover','mouseenter','mousemove'].forEach(function(t){{el.dispatchEvent(new MouseEvent(t,{{bubbles:true}}));}});return 'OK';}})()"
        );
        self.act_js(session_id, &js, target)
    }

    fn wait(&self, session_id: &str, selector: &str, timeout_ms: u64) -> Result<(), String> {
        let tab = self.tab_for(session_id)?;
        let dur = std::time::Duration::from_millis(timeout_ms);
        let r = tab
            .wait_for_element_with_custom_timeout(selector, dur)
            .map(|_| ())
            .map_err(|e| e.to_string());
        if r.is_err() {
            self.evict(session_id);
        }
        r
    }

    fn eval(&self, session_id: &str, js: &str) -> Result<String, String> {
        let tab = self.tab_for(session_id)?;
        let out = match tab.evaluate(js, true) {
            Ok(o) => o
                .value
                .map(|v| v.to_string())
                .or(o.description)
                .unwrap_or_else(|| "undefined".to_string()),
            Err(e) => {
                self.evict(session_id);
                return Err(e.to_string());
            }
        };
        // eval `location=` ile bloklu host'a gidebilir → guard.
        self.guard_blocked_url(session_id)?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_metadata_and_link_local() {
        assert!(is_blocked_host("http://169.254.169.254/latest/meta-data/"));
        assert!(is_blocked_host("http://169.254.0.1"));
        assert!(is_blocked_host(
            "http://metadata.google.internal/computeMetadata/v1/"
        ));
        assert!(is_blocked_host("http://[fd00:ec2::254]/"));
    }

    #[test]
    fn blocks_normalized_bypasses() {
        // trailing-dot FQDN
        assert!(is_blocked_host("http://metadata.google.internal./"));
        // IPv4-mapped / -compatible IPv6
        assert!(is_blocked_host("http://[::ffff:169.254.169.254]/"));
        assert!(is_blocked_host("http://2852039166/"));
        assert!(is_blocked_host("http://0xA9FEA9FE/"));
        assert!(is_blocked_host("http://0251.0376.0251.0376/"));
        // link-local IPv6 fe80::/10
        assert!(is_blocked_host("http://[fe80::1]/"));
    }

    #[test]
    fn allows_localhost_lan_public() {
        assert!(!is_blocked_host("http://localhost:5173/"));
        assert!(!is_blocked_host("http://127.0.0.1:3000"));
        assert!(!is_blocked_host("http://192.168.1.50:8080/app"));
        assert!(!is_blocked_host("http://10.0.0.5"));
        assert!(!is_blocked_host("https://example.com/"));
        assert!(!is_blocked_host("https://user@example.com/path?q=1"));
    }

    #[test]
    fn ref_selector_digit_vs_css() {
        assert_eq!(ref_selector("14"), "[data-cz-ref=\"14\"]");
        assert_eq!(ref_selector("button.primary"), "button.primary");
        assert_eq!(ref_selector("#submit"), "#submit");
        assert_eq!(ref_selector(""), "");
    }

    #[test]
    fn js_str_escapes_quotes_and_backslash() {
        assert_eq!(js_str("a"), "\"a\"");
        assert_eq!(js_str("a\"b"), "\"a\\\"b\"");
        assert_eq!(js_str("x\\y"), "\"x\\\\y\"");
    }
}

#[derive(Default, Clone)]
pub struct BrowserManager {
    inner: Arc<Inner>,
}

#[tauri::command]
pub async fn browser_navigate(
    state: State<'_, BrowserManager>,
    session_id: String,
    url: String,
) -> Result<NavResult, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.navigate(&session_id, &url))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_screenshot(
    state: State<'_, BrowserManager>,
    session_id: String,
) -> Result<String, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.screenshot(&session_id))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_console(
    state: State<'_, BrowserManager>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.console(&session_id))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_network(
    state: State<'_, BrowserManager>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.network(&session_id))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_close(
    state: State<'_, BrowserManager>,
    session_id: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.close(&session_id))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_snapshot(
    state: State<'_, BrowserManager>,
    session_id: String,
) -> Result<String, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.snapshot(&session_id))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_click(
    state: State<'_, BrowserManager>,
    session_id: String,
    target: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.click(&session_id, &target))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_fill(
    state: State<'_, BrowserManager>,
    session_id: String,
    target: String,
    text: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.fill(&session_id, &target, &text))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_select(
    state: State<'_, BrowserManager>,
    session_id: String,
    target: String,
    value: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.select(&session_id, &target, &value))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_press(
    state: State<'_, BrowserManager>,
    session_id: String,
    key: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.press(&session_id, &key))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_type(
    state: State<'_, BrowserManager>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.type_text(&session_id, &text))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_scroll(
    state: State<'_, BrowserManager>,
    session_id: String,
    target: Option<String>,
    dy: Option<i64>,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.scroll(&session_id, target.as_deref(), dy))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_hover(
    state: State<'_, BrowserManager>,
    session_id: String,
    target: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.hover(&session_id, &target))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_wait(
    state: State<'_, BrowserManager>,
    session_id: String,
    selector: String,
    timeout_ms: u64,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.wait(&session_id, &selector, timeout_ms))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}

#[tauri::command]
pub async fn browser_eval(
    state: State<'_, BrowserManager>,
    session_id: String,
    js: String,
) -> Result<String, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.eval(&session_id, &js))
        .await
        .map_err(|e| format!("browser task hata: {e}"))?
}
