

### Store / Stream
- [x] **[M1] `src/store/sessions.ts:594`** — Eviction flush sırasında gelen mut, evict sonrası flush edilemez → son stream/tool patch'leri DB'ye yazılmaz (veri kaybı). Fix: flush'tan sonra yeniden planlanan timer'ı temizle / flush DB sonrası state re-read.
- [x] **[M2] `src/lib/stream/run-stream.ts:1043`** — Başarılı run'da `persistSession` hatası tüm run'ı error'a çevirir, `finalMessages` (tool kanıtı) kaybolur, `streamSucceeded` silinir. Fix: persist kendi try/catch'i, `streamSucceeded=true` önce set.
- [x] **[M3] `src/App.tsx:2195`** — `onAbortFor` `streamingIds[sid]`'i ölen stream'in kendi finally'sinden önce temizler → sıradaki yeni run'ın streaming flag'i yanlışlıkla temizlenebilir. Fix: flag'i runStream'in finally'si yönetsin.
- [x] **[M4] `src/App.tsx:1985`** — `/compact` stream in-flight iken çalışabilir → stream'in son yazımı kompakti siler. Fix: `streamingIds[sid]` varken reddet/kuyruğa al.
- [x] **[M5] `src/store/jobs.ts:229`** — `cmd.spawn()` başarısızlığı unguarded: job "running" olarak sonsuza dek kalır. Fix: try/catch + "error" finalize + `resolveWaiters`.
- [x] **[M6] `src/lib/stream/run-stream.ts:208`** — Single-flight safety net turn'i sadece warn'la düşürür, bubble sonsuza dek "pending". Fix: düşen run'ın bubble'ına error patch'le.
- [x] **[M7] `src/App.tsx:488`** — Queue drain, preparing turn throw/early-return olursa bir daha ateşlenmez, mesaj takılır. Fix: preparing counter'ı deps'e ekle / finally'de drain.

### Tools
- [x] **[M8] `src/lib/tools/index.ts:538`** — Browser click/fill/type/navigate/press/scroll/hover `gate()` çağırmaz → plan modu read-only ama model browser'ı aktif sürer. Fix: mutating browser tool'larını gate.
- [x] **[M9] `src/lib/tools/formatters.ts:120`** — `runFormatters` `sessionId`'siz `runBash` → cached `lastCwd` miras; `$FILE` relative yanlış cwd'de çalışır, `|| true` hatayı yutar. Fix: cwd'yi ws-root'a sabitle.
- [x] **[M10] `src/lib/tools/paths.ts:85`** — `assertRealPathWithinWorkspace` canonicalize başarısız olunca sessizce atlanır; workspace içinde dışarı symlink eden parent ile write workspace dışına kaçar. Fix: target'ın en derin mevcut ancestor'ını canonicalize et.
- [x] **[M11] `src/lib/tools/patch.ts:82`** — `*** Add File:` body'sinde `+`'sız satırlar sessizce düşer → dosya korumalı yazılır. Fix: `+`'sız boş olmayan satırları verbatim push et.

### Permission / Plugins
- [x] **[M12] `src/lib/plugins/loader.ts:179` + `sandbox.ts:218`** — `network.allowedHosts` yoksa MCP hiç URL check'siz kaydolur; network.ts fail-closed diyor. Fix: absent allowlist = deny.
- [x] **[M13] `src/lib/hooks.ts:153`** — PreToolUse hook `{"decision":"deny"}` dönerse (exit 0) bloklanmaz, tool çalışır — sessiz grant. Fix: `"block" || "deny"` ikisinde blokla.
- [x] **[M14] `src/lib/security/dangerous-bash.ts:170`** — `remote-exec` regex ilk pipe'tan sonra hemen shell ister; `curl | base64 -d | sh` ve write-then-run bypass. Fix: curl/wget'ten sonraki herhangi shell'i tara.
- [x] **[M15] `src/lib/plugins/install.ts:90`** — `git-subdir` `source.path` + `local` `source.absolutePath` path traversal: attacker manifest'i `~/../.ssh`'yi plugin dir'ine kopyalayabilir. Fix: `..`/absolute reddet.
- [x] **[M16] `src/lib/security/dangerous-bash.ts:82`** — `hasDangerousRm` `$(...)`/`${...}` indirection'ı görmez: `rm -rf $(echo /)` geçer. Fix: expansion-aware tarama.
- [x] **[M17] `src/lib/security/dangerous-bash.ts:175`** — `/dev/tcp` exfil ve `curl -F file=@` kapsanmaz. Fix: `/dev/tcp|/dev/udp` + `-F ...=@` flag'le.

### Config / DB / Memory
- [x] **[M18] `src/lib/config/schema.ts:184`** — Array/record şemalarında tek bozuk element tüm diziyi default'a düşürür (approvalRules, mcpServers, hooks, permission, apiKeys). Fix: element bazlı `.catch`.
- [x] **[M19] `src/lib/config/migrate.ts:117`** — `schemaVersion` koşulsuz CURRENT'a yazılır; yeni sürümden gelen dosya geri damgalanır, migrator yeniden koşar. Fix: sadece `from < CURRENT` iken damgala.
- [x] **[M20] `src/lib/db/migrate-json.ts:49`** — projects loop try/catch'siz: tek upsert hatası `booted` promise'ini kalıcı reject'ler, DB katmanı restart'a dek ölür. Fix: projects loop'unu try/catch, `booted`'ı sıfırla.
- [x] **[M21] `src/lib/memory-store/store.ts:49`** — `isValidEntry` scope doğrulamaz → geçersiz scope'lu legacy entry import olur, sonsuza dek erişilemez. Fix: scope "project"|"global" validate.

### Providers
- [x] **[M22] `src/lib/providers/amazon-bedrock.ts:26`** — env path %100 kırık: tek env var `AK:SK` birleşik string olarak döner, split ile `secretAccessKey` hep undefined. Fix: adapter içinde `AWS_SECRET_ACCESS_KEY`/`AWS_REGION` oku.
- [x] **[M23] `src/lib/providers/google-vertex.ts:30`** — `GOOGLE_VERTEX_API_KEY` (plain key) ile `GOOGLE_APPLICATION_CREDENTIALS` (dosya yolu) ikisi de `credentials`'a doldurulur → env auth asla çalışmaz. Fix: env var'a göre keyFile/credentials/apiKey dallan.
- [x] **[M24] `src/lib/providers/transform.ts:567`** — Gemini integer-enum→string coercion object key sırasına bağlı: `"enum"` `"type"`'dan önce gelirse `type` integer kalır, 400 sürer. Fix: loop sonrası post-pass.
- [x] **[M25] `src/lib/providers/catalog-derived.ts:115`** — anthropic-format routing `fetch: tauriFetch` uygulamaz → Kimi/Zen gateway modelleri CORS'ta hard-fail. Fix: `fetch: tauriFetch` + wrapper'ları uygula.
- [x] **[M26] `src/lib/providers/groq.ts:16`** — Yanlış model ID `qwen-2.5-coder-32b`; gerçeği `qwen2.5-coder-32b`. Fix: rename.
- [x] **[M27] `src/lib/providers/oauth/refresh.ts:76`** — Tek başarısız refresh credential'ı kalıcı siler (network blip'te oturum gider). Fix: sadece definitive invalid_grant'ta temizle.
- [x] **[M28] `src/lib/providers/github-copilot.ts:91`** — `refresh()` tüm hataları yutar (`catch { return null }`) → doRefresh hata sınıfını ayırt edemez. Fix: non-auth hatalarını rethrow / discriminated result.
- [x] **[M29] `src/lib/providers/openai-compatible.ts:19`** — env auth kind literal `"no-key"` bearer token olarak gönderilir; `OPENAI_COMPATIBLE_API_KEY` hiç okunmaz. Fix: env var'ı resolve et veya throw.
- [x] **[M30] `src/lib/providers/secret-store.ts:134`** — index read-modify-write atomik değil → concurrent setCredentialSecret last-write-wins, bir provider'ın index'i kaybolur. Fix: `withLock`.
- [x] **[M31] `src/lib/mcp.ts:383`** — Proactive OAuth refresh eşiği `expires_in <= 60`, diğer her yerde 5dk eager window var → 61sn kala token bayat kullanılır. Fix: eager eşiği kullan.
- [x] **[M32] `src/lib/mcp.ts:497`** — `authed` `serverUrl` pin'siz `getAuth` okur → server başka host'a repoint edilince UI "authed" der. Fix: `getAuthForUrl`.
- [x] **[M33] `src/lib/uri.ts:5`** — `file://host/share` (UNC) host'u kaybeder; Windows'ta yanlış relative path. Fix: authority component'ini ele al.
- [x] **[M34] `src/lib/mcp-oauth-provider.ts:145`** — PKCE verifier + CSRF state `getAuth` ile okunur (URL pin'siz) → yeni flow eski state'i doğrulayabilir. Fix: serverUrl'e pin.
- [x] **[M35] `src/lib/orchestra/acp/connection.ts:67`** — POSIX-only shell wrapper (`cd '…'`, `export`): cmd.exe'de kırılır, ACP worker env/cwd'siz koşar. Fix: spawn options cwd/env. — (obsolete: acp/connection.ts refactor ile silindi)
- [x] **[M36] `src/lib/orchestra/acp/connection.ts:80`** — stdout chunk'larda UTF-8 multibyte split → U+FFFD → JSON.parse fail → mesaj sessizce düşer. Fix: byte buffer + satır sınırında decode. — (obsolete: acp/connection.ts refactor ile silindi)

### Git / Orchestra
- [x] **[M37] `src/lib/orchestra/isolation.ts:23`** — Rename parse'ı ilk token'ı push'lar, new path atlanır → rename edilmiş worker output commit edilmez. Fix: `R/C`'de `tokens[i+1]`. — (obsolete: isolation.ts refactor ile silindi)
- [x] **[M38] `src/lib/git.ts:109`** — Rename dest `lastIndexOf(" ")` ile parse → path'te space varsa yanlış isim. Fix: tab'a kadar slice.
- [x] **[M39] `src/lib/git.ts:713`** — `gitDiffWorktree` index mutates (`add -N`) + `finally`'de reset → concurrent git op'larda index clobber. Fix: index snapshot/restore veya `--no-index`.
- [x] **[M40] `src/lib/orchestra/isolation.ts:323`** — Dirty-check → merge TOCTOU + iki concurrent merge race. Fix: repo başına mutex + merge öncesi re-verify. — (obsolete: isolation.ts refactor ile silindi)
- [x] **[M41] `src/lib/pr-review-daemon.ts:149`** — PR head SHA post öncesi advance edebilir → stale review + çift review. Fix: post öncesi head re-fetch.
- [x] **[M42] `src/lib/stats.ts:179`** — `DAY_MS` sabit ile streak/heatmap DST günlerini kaçırır/tekrarlar. Fix: her iterasyonda midnight re-normalize.
- [x] **[M43] `src/lib/turn-edits.ts:65`** — Birden çok edit tek `@@` header'ı alır, satır numaraları gerçek dosyayla hizasız. Fix: snippet'lere file-position offset + per-hunk header.
- [x] **[M44] `src/lib/agents/runtime/dispatch.ts:118`** — Named-agent pin ile role engine provider/model'i field-field karıştırır → cross-provider/model combo reject edilir. Fix: atomik pair çöz.
- [x] **[M45] `src/lib/agents/parse.ts:198`** — `bash_allow: []` / `tools: []` "unset" sayılır → enforcement atlanır → sınırsız bash/tools. Fix: `!== undefined` kontrolü.
- [x] **[M46] `src/lib/agents/runtime/supervisor.ts:65`** — Already-aborted signal listener'ı hiç ateşlenmez → child run iptal edilemez; `maxWallClockMs` real path'te hiç uygulanmaz. Fix: aborted kontrolü + timeout enforcement.
- [x] **[M47] `src/lib/orchestra/runtime.ts:40`** — İkinci concurrent dispatch ilkinin AbortController'ını overwrite eder → eski run iptal edilemez. Fix: (sessionId, dispatchId) key. — (obsolete: orchestra/runtime.ts refactor ile silindi)

### Components
- [x] **[M48] `src/components/ApprovalModal.tsx:28` + `Dialog.tsx:57`** — Escape hem ConfirmDialog hem ApprovalModal listener'ını tetikler → onay beklerken discard-confirm'i kapatmak onayı da deny eder. Fix: focus stack / stopImmediatePropagation.
- [x] **[M49] `src/components/Composer.tsx:1494`** — Send butonu `images` saymaz → sadece görselli mesaj butonla gönderilemez. Fix: `images.length === 0` ekle.
- [x] **[M50] `src/components/Composer.tsx:901`** — Debounce'lı undo: 300ms içinde Cmd+Z stack'e hiç push edilmemiş olabilir → geri alınamaz. Fix: performUndo'da pending flush.
- [x] **[M51] `src/components/ContextPanel.tsx:896`** — TreeLevel stale entries: workspace değişince eski içerik görünür. Fix: path değişince entries'i sıfırla.
- [x] **[M52] `src/components/FileViewer.tsx:151`** — Blob URL sızıntısı: in-flight read'de path değişirse object URL revoke edilmez. Fix: cleanup'ta revoke.
- [x] **[M53] `src/components/settings/McpTab.tsx:892`** — JSON textarea controlled + parse fail sessiz → ara tuş vuruşlarında input geri sıçrar. Fix: local string draft + blur'da commit.
- [x] **[M54] `src/components/Sidebar.tsx:1587`** — `<button>` içinde `<button>` (fork icon) — invalid HTML, çift handler. Fix: span role=button.
- [x] **[M55] `src/components/TerminalPanel.tsx:369`** — `disposeLiveTerm` `ptyReady` pending iken çağrılırsa spawn devam eder → orphan PTY + disposed xterm'de onData. Fix: disposed flag + abort.
- [x] **[M56] `src/components/settings/HistoryTab.tsx:113`** — Thread A query in-flight iken B açılınca A'nın mesajları B'nin altında render. Fix: request token / stale guard.
- [x] **[M57] `src/components/settings/ProviderConnectModal.tsx:96`** — Device-code flow'da `finally` `oauthBusy`'yi poll'ün set'inden hemen sonra temizler → ikinci flow başlayabilir. Fix: device-code dalında finally'de temizleme.
- [x] **[M58] `src/components/SearchOverlay.tsx:53`** — Debounce in-flight query'yi iptal etmez → eski sonuç yenisini ezer. Fix: seq/alive guard.
- [x] **[M59] `src/components/TurnReviewActions.tsx:242`** — Cmd+Enter busy guard'sız → çift commit. Fix: `if (busy) return`.
- [x] **[M60] `src/components/PluginsTab.tsx:87`** — Marketplace index fetch cancellation yok. Fix: loadSeq ref.
- [x] **[M61] `src/components/PluginInstallApproval.tsx:61`** — `ack` manifest değişince resetlenmez → B pre-acked kurulur. Fix: prevManifest değişince setAck(false).
- [x] **[M62] `src/components/PluginInstallApproval.tsx:73`** — Sig verification "checking" iken install butonu açık → imzasız plugin kurulabilir. Fix: checking iken disable.
- [x] **[M63] `src/components/MessageList.tsx:148`** — Search açıkken her delta yeni matchIds array'i → scrollIntoView + flash her token'da. Fix: stabil string deps.
- [x] **[M64] `src/components/PromptDialog.tsx:25`** — `useState(initialValue)` yeniden sync olmaz → farklı initialValue ile tekrar açılınca eski draft. Fix: open flips true iken reset.
- [x] **[M65] `src/components/PRPanel.tsx:76`** — `startPrReviewDaemon` cleanup + idempotence yok → duplicate daemon, duplicate PR yorumları. Fix: running ref + unmount stop.
- [x] **[M66] `src/components/PreviewPanel.tsx:305`** — iframe sandbox `allow-same-origin + allow-scripts` arbitrary local HTML'de → asset-protocol origin'inde script çalışır. Fix: file preview'da allow-same-origin'i kaldır / izole origin.

### Lib (misc)
- [x] **[M67] `src/lib/hooks/useAiPanelAuto.ts:46`** — "agents" AI_TRANSIENT_MODES'ta değil → agent panelleri run sonrası kalıcı. Fix: ekle.
- [x] **[M68] `src/lib/hooks/useKeyboardShortcuts.ts:45`** — ⌘K palette binding inline-edit ⌘K shortcut'ını yutar. Fix: editable/selection-aware guard.
- [x] **[M69] `src/lib/token-savers/compact-output/filters/grep.ts:8`** — Windows drive colon parse edilemez → grep filter Windows'ta hiç kompakt etmez. Fix: drive-letter colon.
- [x] **[M70] `src/lib/token-savers/compact-output/filters/build.ts:8`** — "Finished"/"Compiled"/"Built" success satırları PROGRESS_RE ile düşer. Fix: success-summary token'ları hariç tut.
- [x] **[M71] `src/lib/file-content-cache.ts:13`** — Windows'ta path lowercase değil → case-insensitive FS'te cache miss / stale. Fix: drive+path lowercase.
- [x] **[M72] `src/lib/internal-drag.ts:93`** — `recentDrag` setTimeout(0) ile temizlenir, click ondan önce gelir → drag-through click'ler bastırılmaz. Fix: sync flag + pointerdown'da temizle.
- [x] **[M73] `src/lib/file-clipboard.ts:75`** — Self-paste guard case-sensitive → Windows'ta `C:\Foo`→`c:\foo\sub` kopya recursive sonsuz. Fix: case-insensitive karşılaştır.
- [x] **[M74] `src/lib/file-clipboard.ts:51`** — `copyRecursive` symlink'leri sessizce atlar → cut-paste symlink veri kaybı. Fix: symlink recreate.
- [x] **[M75] `src/lib/hooks/useBootStores.ts:21`** — Retention cleanup pinned/active session'ları da siler. Fix: pinned/active/starred hariç.
- [x] **[M76] `src/lib/wildcard.ts:24`** — macOS case-sensitive, Windows case-insensitive — platformlar arası davranış farkı. Fix: volume'a göre.
- [x] **[M77] `src/lib/detect-urls.ts:21`** — URL_RE port'tan sonra boundary yok: `http://localhost:5173.evil.com` localhost sanılır. Fix: `(?![\w.])`.
- [x] **[M78] `src/lib/privacy/index.ts:110`** — Custom label builtin type ile çakışırsa placeholder çakışır → unscrub yanlış değeri geri koyar. Fix: namespace.
- [x] **[M79] `src/lib/i18n/index.ts:27`** — İki hızlı `setLocale` out-of-order resolve → yanlış locale kazanır. Fix: serialize / stale discard.
- [x] **[M80] `src/lib/hooks/useSuggestionsAuto.ts:77`** — `enabled` stale closure (deps sadece [activeStreaming]). Fix: setting'i effect içinde oku.
- [x] **[M81] `src/lib/useWindowFocused.ts:18`** — Unmount öncesi `onFocusChanged` resolve ederse `unlisten` hiç yakalanmaz → Tauri listener sızar (StrictMode çift register). Fix: ref'e await öncesi sakla.
- [x] **[M82] `src/lib/theme.ts:130`** — Pre-JS theme bootstrap yok → dark/system kullanıcısı her açılışta light FOUC. Fix: index.html'de inline script.
- [x] **[M83] `src/lib/model-history.ts:42`** — `slice(0, maxChars)` surrogate pair'i böler → HTTP 400 "no low surrogate". Fix: `sliceCharsSafe`.
- [x] **[M84] `src/lib/token-savers/compress-tools/index.ts:8`** — Shared ToolSet'te descriptions in-place compress, restore yok → setting kapatılınca kalıcı bozuk. Fix: copy üzerinde çalış / orijinal sakla.
- [x] **[M85] `src/lib/agents/runtime/supervisor.ts:49`** — `maxDepth` literal `1` ve hiçbir yol depth>=1 geçirmez → dead config. Fix: type'ı genişlet + gerçek depth thread et.

### Rust
- [x] **[M86] `src-tauri/src/db.rs`** (H14 altı) — bkz H14.
- [x] **[M87] `src-tauri/src/fs.rs:224`** — `fs_copy_dir` sadece dest validate eder, src check'siz → `~/.ssh` kopyalanabilir. Fix: `ensure_read_allowed(src)`.
- [x] **[M88] `src-tauri/src/fs.rs:249`** — `ensure_under_codezal` root'un kendisini canonicalize eder; root symlink → `/` ise `fs_remove_dir` herhangi path siler. Fix: canonical root'u real home ile doğrula.
- [x] **[M89] `src-tauri/src/fs.rs:57`** — Home-wide read+write allowlist dotfiles'ı kapsar (`~/.ssh` vs) + check-then-act TOCTOU. Fix: canonicalized path üzerinde op + dot-dir hariç.
- [x] **[M90] `src-tauri/src/browser.rs:286`** — SSRF guard sadece pre-navigation URL; redirect'ler + DNS → 169.254.x re-check edilmez. Fix: navigate sonrası `is_blocked_host` re-check.
- [x] **[M91] `src-tauri/src/lib.rs:35`** — keep-awake child (caffeinate/powershell) app exit'te kill edilmez → orphan. Fix: Drop / Exit event.
- [x] **[M92] `src-tauri/src/pty.rs:236`** — `kill_process_tree` snapshot sonrası fork eden child orphan kalır (Windows taskkill aynı). Fix: process group / rescan.
- [x] **[M93] `src-tauri/src/browser.rs:238`** — `tab_for` check-then-insert race → ikinci tab leak (1h idle'a dek). Fix: tabs lock altında create.

### Tests
- [x] **[M94] `tests/exec.test.ts:6`** — `stripLineEnding` inline kopya ile test edilir (gerçek import değil) → gerçek fonksiyon regresyonu asla yakalanmaz. Fix: gerçek export'u test et.
- [x] **[M95] `tests/approval-match.test.ts:78`** — `void request().then()` await'siz + sync assert → microtask zayıflığı, unhandled rejection riski. Fix: await Promise.resolve() + await p.
- [x] **[M96] `tests/snapshots.test.ts:88`** — `describe.skipIf(!canRun)` revertToBase entegrasyonunu sessizce komple devre dışı bırakır (Windows CI). Fix: beforeAll'da expect + fail loudly.
- [x] **[M97] `src/lib/methods/core.ts:62`** — `upsertMethod` `createdAt`/`lastUsedAt`'i her kayıtta sıfırlar → yaş-decay skoru bozulur. Fix: prior değerleri koru.
- [x] **[M98] `src/lib/methods/store.ts:125`** — project+global methods dedup'suz concatenate → prompt'ta çift talimat + `refreshUsage` self-reinforcing feedback. Fix: isme göre dedup + gerçek kullanım say.
- [x] **[M99] `src/lib/routine-scheduler.ts:83`** — Aynı dakika içinde restart routine'i çift ateşler (persisted `state.fired` vs boş `lastFiredAt`). Fix: `state.fired`'ı da kontrol et.
- [x] **[M100] `src/lib/cron.ts:43`** — `N/step` tek değere genişler (`5/10` → `{5}`); standart cron 5,15,…,55. Fix: step varken `end=hi`.
- [x] **[M101] `src/lib/notify.ts:60`** — `pendingTargetSessionId` herhangi window focus'ta tüketilir → bildirimi yok sayıp alt-tab yapınca eski session'a zıplar. Fix: sadece onAction veya timestamp+expire.
- [x] **[M102] `src/lib/agents/runtime/dispatch.ts:49`** — `existingChildCount` tüm run'ları sayar (per-turn değil) → maxChildRunsPerTurn erken tetiklenir. Fix: turn başına reset.

## LOW — 132 (özet, detay için kaynak raporlar)

- **Store/Stream:** run-stream.ts:1097 çift persist satırı (duplicate flush); update.ts:41 download single-flight yok; App.tsx:2094 codemap manual build race.
- **Tools:** fs.ts:190 CRLF `\r` sızıntısı; fs.ts:249 non-atomic write + TOCTOU; web.ts:426 `fc/fd/fe80` prefix false-positive IPv6 bloğu; file-watcher.ts:30 gitMetaTimer cleanup yok; file-watcher.ts:36 `dist/build/target/out` isimli dosyalar ignore; monitor.ts:6 regex catastrophic backtracking; notebook.ts:115 lock yok; index.ts:1434 formatter'lar hook-rewrite path'i almıyor; exec.ts:198 timeout kill fire-and-forget; patch.ts:280 no-op hunk sayımı; stdio-transport.ts:68 spawn timeout yok.
- **Permission/Plugins:** hooks.ts:29 hook trust id ile keylenmiş (fingerprint yok); fingerprint.ts:21 symlink target hash'lenmez; audit.ts:105 tam entry console.warn (secret sızabilir); legacy.ts:14 `"*"` append exact deny'i prefix'e çevirir; sandbox.ts:73 validateHookCommand regex bypass; marketplace.ts:164 manifestPath `..`/absolute containment yok.
- **Config/DB:** config/parse.ts:76 trailing-comma regex string içi bozar; memory-store/store.ts:49 scope validate yok; config/schema.ts:431 `theme` load'da clobber; sessions-db.ts:232 corrupt blob JSON.parse throw.
- **Providers:** cerebras.ts:16 `qwen-3-32b`→`qwen3-32b`; auth.ts:15 isConnectedSync unresolvable token'da "connected" der; error.ts:187 413→context_overflow yanlış sınıf; error.ts:78 auth pattern quota'yı "reconnect"e düşürür; error.ts:210 nested error field parse yok; azure.ts:29 deployment name mapping yok; client-versions.ts:32 registry fetch timeout yok; id.ts:30 modulo bias; mcp.ts:152 `/oauth/i` yanlış needsAuth; secret-store.ts:121 array `typeof h==="object"` kabulü.
- **Skills/Agents:** skills/parse.ts:21 empty name `""` dedup çakışması; agents/parse.ts:23 block scalar/bool/float mis-parse; agents-seed.ts:361 regex `\]` truncate; skills/frontmatter.ts:62 dotted keys + unindented list; sdd-trace.ts:47 `R-1x` false match; prompt-enhance.ts:18 stripFence trailing newline; small-model.ts:49 free model'lar cost path'ten elenir; skills/parse.ts:40 untrusted description system prompt'a injection; agents/parse.ts:191 bashDeny prefix chained command bypass.
- **Git/Orchestra:** pr-review-daemon.ts:67 corrupt localStorage → tüm PR'ları spam review; pr-uri/diff-uri/turn-diff-uri decodeURIComponent throw; git.ts:565 ref option injection; turn-edits.ts:75 line count +1; terminal-path-input.ts:4 Windows quote double; acp/connection.ts:103 spawn öncesi close orphan; diff.ts:17 büyük diff fallback tam dosyayı değişmiş gösterir; git-review.ts:153 ` b/` içeren path split.
- **Components:** CodeEditor.tsx:70 unmount cleanup stale path; AgentTaskCard.tsx:125 durum etiketi çift render; Composer.tsx:929 watcher unmount cleanup yok; Composer.tsx:1356 IME composition check yok; ContextPanel.tsx:162 resize listener cleanup yok; DiffViewer.tsx:33 staged state uri değişince resetlenmez; CodeView.tsx:80 trailing newline hayalet satır; DiffView.tsx:231 hardcoded EN; Dialog.tsx:69 focus trap kaçışı; CustomProviderModal.tsx:382 çift save; StoredImage.tsx:29 revoke stale; Sidebar.tsx:126 drag width ref; RoutinesOverlay.tsx:358 edit before load; useSddDocSync.ts:61 expectPreviewRef stale; SkillsTab.tsx:19 reload stale; ModelsPage.tsx:71 probe stale; TerminalCliIcon.tsx:44 gradient id çakışması; WindowsAppMenu.tsx:44 Escape yok.
- **Markdown/Preview:** MessageList.tsx:707 Bubble memo comparator eksik; Markdown.tsx:195 boundary permanent error; MermaidBlock.tsx:31 theme once; MarkdownWysiwyg.tsx:80 placeholder static; PRPanel.tsx:86 hardcoded TR toast; PluginInstallApproval.tsx:210 `.replace("{count}")` translated string; PreviewPanel.tsx:112 log reset yok; MessageList.tsx:790 copy setTimeout cleanup yok; PRPanel.tsx:687 TokenForm save try/catch yok; OutputViewer.tsx:10 no subscription; InlineEditBar.tsx:44 refocus edge.
- **Lib misc:** useNavHistory.ts:35 suppress stuck; workspace-roots.ts:24 case-sensitive merge; fs-browse.ts:48 dotfile case; file-invalidate.ts:21 `.git` case; rg-download.ts:14 no exec check + no `.exe`; file-clipboard.ts:83 cut fail clipboard temizler; output-doc.ts:16 insertion-order eviction; compact-output/detect.ts:19 `npm test` generic'e düşer; workspace-tree.ts:25 localeCompare locale'siz; wildcard.ts:22 `*`→`.*` `/` geçer; scroll-memory.ts:3 unbounded Map; theme-loader.ts:68 id collision; protected.ts:68 case-sensitive; useBootDraft.ts:13 her boot yeni draft; history-hygiene:52 TR marker; privacy/index.ts:65 wrong span replace.
- **Commands/Cron/Vim:** commands/parse.ts:55 escape check dead; parse.ts:81 escaped named placeholder; parse.ts:29 apostrophe strip; parse.ts:61 tab-arg; commands/index.ts:47 builtin override yok; routine-scheduler.ts:50 once+fireAt fire etmez; routine-scheduler.ts:162 wake miss; cron.ts:70 dom+dow AND; cron.ts:19 dow:7 reject; vim engine: 2J join, J empty line, cw space, b leading, t/T neighbor, text-object count, useVim.ts:40 desync; updater.ts:25 no re-entrancy; editor-save.ts:8 consumeSelfWrite mark silmez; tokens.ts:66 file part'ları sayılmaz; search.ts:134 grep-fallback glob dir prefix; replay.ts:26 + side-chat.ts:31 non-string content trim throw; suggestions.ts:79 trailing `]`; composer-drop.ts:27 random composer fallback; use-commit-review.tsx:95 reentrant gate hang; image.ts:76 no size budget; system-prompt.ts:291 MCP budget ilk server'ı aşar.
- **Rust:** exec.rs:255 tasklist substring PID; browser.rs:135 IPv4-compatible IPv6 bypass; code_map.rs:98 DefaultHasher sabit key; code_map.rs:1466 error'lar yutulur; pty.rs:388 rc-file symlink overwrite; code_map.rs:1087 per-command connection interleave.
- **Tests:** memory-store.test.ts:79 +200 token slack; agent-supervisor.test.ts:246 real sleep flaky; lock-serialize.test.ts:12 + workflow-semaphore.test.ts:13 fixed sleeps; routine-scheduler.test.ts:8 cron+mocked module.

---

## Takip notları

- Her fix: test yaz (önce fail), sonra fix, `npx eslint .` + `npx tsc --noEmit --ignoreDeprecations 5.0 -p tsconfig.app.json` + `npm test`.
- Commit: `fix: #H#` / `fix: #M#` etiketiyle.
- HIGH'lar öncelikli: H2 (pty deadlock), H3 (privacy), H4/H5 (plugin güvenlik), H9 (mcp-auth), H6-8 (provider CORS), H10 (approval ters aksiyon).
- Bu dosya silinmez — kapandıkça checkbox işaretle.
## MED — 100

### Store / Stream
- [x] **[M1] `src/store/sessions.ts:594`** — Eviction flush sırasında gelen mut, evict sonrası flush edilemez → son stream/tool patch'leri DB'ye yazılmaz (veri kaybı). Fix: flush'tan sonra yeniden planlanan timer'ı temizle / flush DB sonrası state re-read.
- [x] **[M2] `src/lib/stream/run-stream.ts:1043`** — Başarılı run'da `persistSession` hatası tüm run'ı error'a çevirir, `finalMessages` (tool kanıtı) kaybolur, `streamSucceeded` silinir. Fix: persist kendi try/catch'i, `streamSucceeded=true` önce set.
- [x] **[M3] `src/App.tsx:2195`** — `onAbortFor` `streamingIds[sid]`'i ölen stream'in kendi finally'sinden önce temizler → sıradaki yeni run'ın streaming flag'i yanlışlıkla temizlenebilir. Fix: flag'i runStream'in finally'si yönetsin.
- [x] **[M4] `src/App.tsx:1985`** — `/compact` stream in-flight iken çalışabilir → stream'in son yazımı kompakti siler. Fix: `streamingIds[sid]` varken reddet/kuyruğa al.
- [x] **[M5] `src/store/jobs.ts:229`** — `cmd.spawn()` başarısızlığı unguarded: job "running" olarak sonsuza dek kalır. Fix: try/catch + "error" finalize + `resolveWaiters`.
- [x] **[M6] `src/lib/stream/run-stream.ts:208`** — Single-flight safety net turn'i sadece warn'la düşürür, bubble sonsuza dek "pending". Fix: düşen run'ın bubble'ına error patch'le.
- [x] **[M7] `src/App.tsx:488`** — Queue drain, preparing turn throw/early-return olursa bir daha ateşlenmez, mesaj takılır. Fix: preparing counter'ı deps'e ekle / finally'de drain.

### Tools
- [x] **[M8] `src/lib/tools/index.ts:538`** — Browser click/fill/type/navigate/press/scroll/hover `gate()` çağırmaz → plan modu read-only ama model browser'ı aktif sürer. Fix: mutating browser tool'larını gate.
- [x] **[M9] `src/lib/tools/formatters.ts:120`** — `runFormatters` `sessionId`'siz `runBash` → cached `lastCwd` miras; `$FILE` relative yanlış cwd'de çalışır, `|| true` hatayı yutar. Fix: cwd'yi ws-root'a sabitle.
- [x] **[M10] `src/lib/tools/paths.ts:85`** — `assertRealPathWithinWorkspace` canonicalize başarısız olunca sessizce atlanır; workspace içinde dışarı symlink eden parent ile write workspace dışına kaçar. Fix: target'ın en derin mevcut ancestor'ını canonicalize et.
- [x] **[M11] `src/lib/tools/patch.ts:82`** — `*** Add File:` body'sinde `+`'sız satırlar sessizce düşer → dosya korumalı yazılır. Fix: `+`'sız boş olmayan satırları verbatim push et.

### Permission / Plugins
- [x] **[M12] `src/lib/plugins/loader.ts:179` + `sandbox.ts:218`** — `network.allowedHosts` yoksa MCP hiç URL check'siz kaydolur; network.ts fail-closed diyor. Fix: absent allowlist = deny.
- [x] **[M13] `src/lib/hooks.ts:153`** — PreToolUse hook `{"decision":"deny"}` dönerse (exit 0) bloklanmaz, tool çalışır — sessiz grant. Fix: `"block" || "deny"` ikisinde blokla.
- [x] **[M14] `src/lib/security/dangerous-bash.ts:170`** — `remote-exec` regex ilk pipe'tan sonra hemen shell ister; `curl | base64 -d | sh` ve write-then-run bypass. Fix: curl/wget'ten sonraki herhangi shell'i tara.
- [x] **[M15] `src/lib/plugins/install.ts:90`** — `git-subdir` `source.path` + `local` `source.absolutePath` path traversal: attacker manifest'i `~/../.ssh`'yi plugin dir'ine kopyalayabilir. Fix: `..`/absolute reddet.
- [x] **[M16] `src/lib/security/dangerous-bash.ts:82`** — `hasDangerousRm` `$(...)`/`${...}` indirection'ı görmez: `rm -rf $(echo /)` geçer. Fix: expansion-aware tarama.
- [x] **[M17] `src/lib/security/dangerous-bash.ts:175`** — `/dev/tcp` exfil ve `curl -F file=@` kapsanmaz. Fix: `/dev/tcp|/dev/udp` + `-F ...=@` flag'le.

### Config / DB / Memory
- [x] **[M18] `src/lib/config/schema.ts:184`** — Array/record şemalarında tek bozuk element tüm diziyi default'a düşürür (approvalRules, mcpServers, hooks, permission, apiKeys). Fix: element bazlı `.catch`.
- [x] **[M19] `src/lib/config/migrate.ts:117`** — `schemaVersion` koşulsuz CURRENT'a yazılır; yeni sürümden gelen dosya geri damgalanır, migrator yeniden koşar. Fix: sadece `from < CURRENT` iken damgala.
- [x] **[M20] `src/lib/db/migrate-json.ts:49`** — projects loop try/catch'siz: tek upsert hatası `booted` promise'ini kalıcı reject'ler, DB katmanı restart'a dek ölür. Fix: projects loop'unu try/catch, `booted`'ı sıfırla.
- [x] **[M21] `src/lib/memory-store/store.ts:49`** — `isValidEntry` scope doğrulamaz → geçersiz scope'lu legacy entry import olur, sonsuza dek erişilemez. Fix: scope "project"|"global" validate.

### Providers
- [x] **[M22] `src/lib/providers/amazon-bedrock.ts:26`** — env path %100 kırık: tek env var `AK:SK` birleşik string olarak döner, split ile `secretAccessKey` hep undefined. Fix: adapter içinde `AWS_SECRET_ACCESS_KEY`/`AWS_REGION` oku.
- [x] **[M23] `src/lib/providers/google-vertex.ts:30`** — `GOOGLE_VERTEX_API_KEY` (plain key) ile `GOOGLE_APPLICATION_CREDENTIALS` (dosya yolu) ikisi de `credentials`'a doldurulur → env auth asla çalışmaz. Fix: env var'a göre keyFile/credentials/apiKey dallan.
- [x] **[M24] `src/lib/providers/transform.ts:567`** — Gemini integer-enum→string coercion object key sırasına bağlı: `"enum"` `"type"`'dan önce gelirse `type` integer kalır, 400 sürer. Fix: loop sonrası post-pass.
- [x] **[M25] `src/lib/providers/catalog-derived.ts:115`** — anthropic-format routing `fetch: tauriFetch` uygulamaz → Kimi/Zen gateway modelleri CORS'ta hard-fail. Fix: `fetch: tauriFetch` + wrapper'ları uygula.
- [x] **[M26] `src/lib/providers/groq.ts:16`** — Yanlış model ID `qwen-2.5-coder-32b`; gerçeği `qwen2.5-coder-32b`. Fix: rename.
- [x] **[M27] `src/lib/providers/oauth/refresh.ts:76`** — Tek başarısız refresh credential'ı kalıcı siler (network blip'te oturum gider). Fix: sadece definitive invalid_grant'ta temizle.
- [x] **[M28] `src/lib/providers/github-copilot.ts:91`** — `refresh()` tüm hataları yutar (`catch { return null }`) → doRefresh hata sınıfını ayırt edemez. Fix: non-auth hatalarını rethrow / discriminated result.
- [x] **[M29] `src/lib/providers/openai-compatible.ts:19`** — env auth kind literal `"no-key"` bearer token olarak gönderilir; `OPENAI_COMPATIBLE_API_KEY` hiç okunmaz. Fix: env var'ı resolve et veya throw.
- [x] **[M30] `src/lib/providers/secret-store.ts:134`** — index read-modify-write atomik değil → concurrent setCredentialSecret last-write-wins, bir provider'ın index'i kaybolur. Fix: `withLock`.
- [x] **[M31] `src/lib/mcp.ts:383`** — Proactive OAuth refresh eşiği `expires_in <= 60`, diğer her yerde 5dk eager window var → 61sn kala token bayat kullanılır. Fix: eager eşiği kullan.
- [x] **[M32] `src/lib/mcp.ts:497`** — `authed` `serverUrl` pin'siz `getAuth` okur → server başka host'a repoint edilince UI "authed" der. Fix: `getAuthForUrl`.
- [x] **[M33] `src/lib/uri.ts:5`** — `file://host/share` (UNC) host'u kaybeder; Windows'ta yanlış relative path. Fix: authority component'ini ele al.
- [x] **[M34] `src/lib/mcp-oauth-provider.ts:145`** — PKCE verifier + CSRF state `getAuth` ile okunur (URL pin'siz) → yeni flow eski state'i doğrulayabilir. Fix: serverUrl'e pin.
- [x] **[M35] `src/lib/orchestra/acp/connection.ts:67`** — POSIX-only shell wrapper (`cd '…'`, `export`): cmd.exe'de kırılır, ACP worker env/cwd'siz koşar. Fix: spawn options cwd/env. — (obsolete: acp/connection.ts refactor ile silindi)
- [x] **[M36] `src/lib/orchestra/acp/connection.ts:80`** — stdout chunk'larda UTF-8 multibyte split → U+FFFD → JSON.parse fail → mesaj sessizce düşer. Fix: byte buffer + satır sınırında decode. — (obsolete: acp/connection.ts refactor ile silindi)

### Git / Orchestra
- [x] **[M37] `src/lib/orchestra/isolation.ts:23`** — Rename parse'ı ilk token'ı push'lar, new path atlanır → rename edilmiş worker output commit edilmez. Fix: `R/C`'de `tokens[i+1]`. — (obsolete: isolation.ts refactor ile silindi)
- [x] **[M38] `src/lib/git.ts:109`** — Rename dest `lastIndexOf(" ")` ile parse → path'te space varsa yanlış isim. Fix: tab'a kadar slice.
- [x] **[M39] `src/lib/git.ts:713`** — `gitDiffWorktree` index mutates (`add -N`) + `finally`'de reset → concurrent git op'larda index clobber. Fix: index snapshot/restore veya `--no-index`.
- [x] **[M40] `src/lib/orchestra/isolation.ts:323`** — Dirty-check → merge TOCTOU + iki concurrent merge race. Fix: repo başına mutex + merge öncesi re-verify. — (obsolete: isolation.ts refactor ile silindi)
- [x] **[M41] `src/lib/pr-review-daemon.ts:149`** — PR head SHA post öncesi advance edebilir → stale review + çift review. Fix: post öncesi head re-fetch.
- [x] **[M42] `src/lib/stats.ts:179`** — `DAY_MS` sabit ile streak/heatmap DST günlerini kaçırır/tekrarlar. Fix: her iterasyonda midnight re-normalize.
- [x] **[M43] `src/lib/turn-edits.ts:65`** — Birden çok edit tek `@@` header'ı alır, satır numaraları gerçek dosyayla hizasız. Fix: snippet'lere file-position offset + per-hunk header.
- [x] **[M44] `src/lib/agents/runtime/dispatch.ts:118`** — Named-agent pin ile role engine provider/model'i field-field karıştırır → cross-provider/model combo reject edilir. Fix: atomik pair çöz.
- [x] **[M45] `src/lib/agents/parse.ts:198`** — `bash_allow: []` / `tools: []` "unset" sayılır → enforcement atlanır → sınırsız bash/tools. Fix: `!== undefined` kontrolü.
- [x] **[M46] `src/lib/agents/runtime/supervisor.ts:65`** — Already-aborted signal listener'ı hiç ateşlenmez → child run iptal edilemez; `maxWallClockMs` real path'te hiç uygulanmaz. Fix: aborted kontrolü + timeout enforcement.
- [x] **[M47] `src/lib/orchestra/runtime.ts:40`** — İkinci concurrent dispatch ilkinin AbortController'ını overwrite eder → eski run iptal edilemez. Fix: (sessionId, dispatchId) key. — (obsolete: orchestra/runtime.ts refactor ile silindi)

### Components
- [x] **[M48] `src/components/ApprovalModal.tsx:28` + `Dialog.tsx:57`** — Escape hem ConfirmDialog hem ApprovalModal listener'ını tetikler → onay beklerken discard-confirm'i kapatmak onayı da deny eder. Fix: focus stack / stopImmediatePropagation.
- [x] **[M49] `src/components/Composer.tsx:1494`** — Send butonu `images` saymaz → sadece görselli mesaj butonla gönderilemez. Fix: `images.length === 0` ekle.
- [x] **[M50] `src/components/Composer.tsx:901`** — Debounce'lı undo: 300ms içinde Cmd+Z stack'e hiç push edilmemiş olabilir → geri alınamaz. Fix: performUndo'da pending flush.
- [x] **[M51] `src/components/ContextPanel.tsx:896`** — TreeLevel stale entries: workspace değişince eski içerik görünür. Fix: path değişince entries'i sıfırla.
- [x] **[M52] `src/components/FileViewer.tsx:151`** — Blob URL sızıntısı: in-flight read'de path değişirse object URL revoke edilmez. Fix: cleanup'ta revoke.
- [x] **[M53] `src/components/settings/McpTab.tsx:892`** — JSON textarea controlled + parse fail sessiz → ara tuş vuruşlarında input geri sıçrar. Fix: local string draft + blur'da commit.
- [x] **[M54] `src/components/Sidebar.tsx:1587`** — `<button>` içinde `<button>` (fork icon) — invalid HTML, çift handler. Fix: span role=button.
- [x] **[M55] `src/components/TerminalPanel.tsx:369`** — `disposeLiveTerm` `ptyReady` pending iken çağrılırsa spawn devam eder → orphan PTY + disposed xterm'de onData. Fix: disposed flag + abort.
- [x] **[M56] `src/components/settings/HistoryTab.tsx:113`** — Thread A query in-flight iken B açılınca A'nın mesajları B'nin altında render. Fix: request token / stale guard.
- [x] **[M57] `src/components/settings/ProviderConnectModal.tsx:96`** — Device-code flow'da `finally` `oauthBusy`'yi poll'ün set'inden hemen sonra temizler → ikinci flow başlayabilir. Fix: device-code dalında finally'de temizleme.
- [x] **[M58] `src/components/SearchOverlay.tsx:53`** — Debounce in-flight query'yi iptal etmez → eski sonuç yenisini ezer. Fix: seq/alive guard.
- [x] **[M59] `src/components/TurnReviewActions.tsx:242`** — Cmd+Enter busy guard'sız → çift commit. Fix: `if (busy) return`.
- [x] **[M60] `src/components/PluginsTab.tsx:87`** — Marketplace index fetch cancellation yok. Fix: loadSeq ref.
- [x] **[M61] `src/components/PluginInstallApproval.tsx:61`** — `ack` manifest değişince resetlenmez → B pre-acked kurulur. Fix: prevManifest değişince setAck(false).
- [x] **[M62] `src/components/PluginInstallApproval.tsx:73`** — Sig verification "checking" iken install butonu açık → imzasız plugin kurulabilir. Fix: checking iken disable.
- [x] **[M63] `src/components/MessageList.tsx:148`** — Search açıkken her delta yeni matchIds array'i → scrollIntoView + flash her token'da. Fix: stabil string deps.
- [x] **[M64] `src/components/PromptDialog.tsx:25`** — `useState(initialValue)` yeniden sync olmaz → farklı initialValue ile tekrar açılınca eski draft. Fix: open flips true iken reset.
- [x] **[M65] `src/components/PRPanel.tsx:76`** — `startPrReviewDaemon` cleanup + idempotence yok → duplicate daemon, duplicate PR yorumları. Fix: running ref + unmount stop.
- [x] **[M66] `src/components/PreviewPanel.tsx:305`** — iframe sandbox `allow-same-origin + allow-scripts` arbitrary local HTML'de → asset-protocol origin'inde script çalışır. Fix: file preview'da allow-same-origin'i kaldır / izole origin.

### Lib (misc)
- [x] **[M67] `src/lib/hooks/useAiPanelAuto.ts:46`** — "agents" AI_TRANSIENT_MODES'ta değil → agent panelleri run sonrası kalıcı. Fix: ekle.
- [x] **[M68] `src/lib/hooks/useKeyboardShortcuts.ts:45`** — ⌘K palette binding inline-edit ⌘K shortcut'ını yutar. Fix: editable/selection-aware guard.
- [x] **[M69] `src/lib/token-savers/compact-output/filters/grep.ts:8`** — Windows drive colon parse edilemez → grep filter Windows'ta hiç kompakt etmez. Fix: drive-letter colon.
- [x] **[M70] `src/lib/token-savers/compact-output/filters/build.ts:8`** — "Finished"/"Compiled"/"Built" success satırları PROGRESS_RE ile düşer. Fix: success-summary token'ları hariç tut.
- [x] **[M71] `src/lib/file-content-cache.ts:13`** — Windows'ta path lowercase değil → case-insensitive FS'te cache miss / stale. Fix: drive+path lowercase.
- [x] **[M72] `src/lib/internal-drag.ts:93`** — `recentDrag` setTimeout(0) ile temizlenir, click ondan önce gelir → drag-through click'ler bastırılmaz. Fix: sync flag + pointerdown'da temizle.
- [x] **[M73] `src/lib/file-clipboard.ts:75`** — Self-paste guard case-sensitive → Windows'ta `C:\Foo`→`c:\foo\sub` kopya recursive sonsuz. Fix: case-insensitive karşılaştır.
- [x] **[M74] `src/lib/file-clipboard.ts:51`** — `copyRecursive` symlink'leri sessizce atlar → cut-paste symlink veri kaybı. Fix: symlink recreate.
- [x] **[M75] `src/lib/hooks/useBootStores.ts:21`** — Retention cleanup pinned/active session'ları da siler. Fix: pinned/active/starred hariç.
- [x] **[M76] `src/lib/wildcard.ts:24`** — macOS case-sensitive, Windows case-insensitive — platformlar arası davranış farkı. Fix: volume'a göre.
- [x] **[M77] `src/lib/detect-urls.ts:21`** — URL_RE port'tan sonra boundary yok: `http://localhost:5173.evil.com` localhost sanılır. Fix: `(?![\w.])`.
- [x] **[M78] `src/lib/privacy/index.ts:110`** — Custom label builtin type ile çakışırsa placeholder çakışır → unscrub yanlış değeri geri koyar. Fix: namespace.
- [x] **[M79] `src/lib/i18n/index.ts:27`** — İki hızlı `setLocale` out-of-order resolve → yanlış locale kazanır. Fix: serialize / stale discard.
- [x] **[M80] `src/lib/hooks/useSuggestionsAuto.ts:77`** — `enabled` stale closure (deps sadece [activeStreaming]). Fix: setting'i effect içinde oku.
- [x] **[M81] `src/lib/useWindowFocused.ts:18`** — Unmount öncesi `onFocusChanged` resolve ederse `unlisten` hiç yakalanmaz → Tauri listener sızar (StrictMode çift register). Fix: ref'e await öncesi sakla.
- [x] **[M82] `src/lib/theme.ts:130`** — Pre-JS theme bootstrap yok → dark/system kullanıcısı her açılışta light FOUC. Fix: index.html'de inline script.
- [x] **[M83] `src/lib/model-history.ts:42`** — `slice(0, maxChars)` surrogate pair'i böler → HTTP 400 "no low surrogate". Fix: `sliceCharsSafe`.
- [x] **[M84] `src/lib/token-savers/compress-tools/index.ts:8`** — Shared ToolSet'te descriptions in-place compress, restore yok → setting kapatılınca kalıcı bozuk. Fix: copy üzerinde çalış / orijinal sakla.
- [x] **[M85] `src/lib/agents/runtime/supervisor.ts:49`** — `maxDepth` literal `1` ve hiçbir yol depth>=1 geçirmez → dead config. Fix: type'ı genişlet + gerçek depth thread et.

### Rust
- [x] **[M86] `src-tauri/src/db.rs`** (H14 altı) — bkz H14.
- [x] **[M87] `src-tauri/src/fs.rs:224`** — `fs_copy_dir` sadece dest validate eder, src check'siz → `~/.ssh` kopyalanabilir. Fix: `ensure_read_allowed(src)`.
- [x] **[M88] `src-tauri/src/fs.rs:249`** — `ensure_under_codezal` root'un kendisini canonicalize eder; root symlink → `/` ise `fs_remove_dir` herhangi path siler. Fix: canonical root'u real home ile doğrula.
- [x] **[M89] `src-tauri/src/fs.rs:57`** — Home-wide read+write allowlist dotfiles'ı kapsar (`~/.ssh` vs) + check-then-act TOCTOU. Fix: canonicalized path üzerinde op + dot-dir hariç.
- [x] **[M90] `src-tauri/src/browser.rs:286`** — SSRF guard sadece pre-navigation URL; redirect'ler + DNS → 169.254.x re-check edilmez. Fix: navigate sonrası `is_blocked_host` re-check.
- [x] **[M91] `src-tauri/src/lib.rs:35`** — keep-awake child (caffeinate/powershell) app exit'te kill edilmez → orphan. Fix: Drop / Exit event.
- [x] **[M92] `src-tauri/src/pty.rs:236`** — `kill_process_tree` snapshot sonrası fork eden child orphan kalır (Windows taskkill aynı). Fix: process group / rescan.
- [x] **[M93] `src-tauri/src/browser.rs:238`** — `tab_for` check-then-insert race → ikinci tab leak (1h idle'a dek). Fix: tabs lock altında create.

### Tests
- [x] **[M94] `tests/exec.test.ts:6`** — `stripLineEnding` inline kopya ile test edilir (gerçek import değil) → gerçek fonksiyon regresyonu asla yakalanmaz. Fix: gerçek export'u test et.
- [x] **[M95] `tests/approval-match.test.ts:78`** — `void request().then()` await'siz + sync assert → microtask zayıflığı, unhandled rejection riski. Fix: await Promise.resolve() + await p.
- [x] **[M96] `tests/snapshots.test.ts:88`** — `describe.skipIf(!canRun)` revertToBase entegrasyonunu sessizce komple devre dışı bırakır (Windows CI). Fix: beforeAll'da expect + fail loudly.
- [x] **[M97] `src/lib/methods/core.ts:62`** — `upsertMethod` `createdAt`/`lastUsedAt`'i her kayıtta sıfırlar → yaş-decay skoru bozulur. Fix: prior değerleri koru.
- [x] **[M98] `src/lib/methods/store.ts:125`** — project+global methods dedup'suz concatenate → prompt'ta çift talimat + `refreshUsage` self-reinforcing feedback. Fix: isme göre dedup + gerçek kullanım say.
- [x] **[M99] `src/lib/routine-scheduler.ts:83`** — Aynı dakika içinde restart routine'i çift ateşler (persisted `state.fired` vs boş `lastFiredAt`). Fix: `state.fired`'ı da kontrol et.
- [x] **[M100] `src/lib/cron.ts:43`** — `N/step` tek değere genişler (`5/10` → `{5}`); standart cron 5,15,…,55. Fix: step varken `end=hi`.
- [x] **[M101] `src/lib/notify.ts:60`** — `pendingTargetSessionId` herhangi window focus'ta tüketilir → bildirimi yok sayıp alt-tab yapınca eski session'a zıplar. Fix: sadece onAction veya timestamp+expire.
- [x] **[M102] `src/lib/agents/runtime/dispatch.ts:49`** — `existingChildCount` tüm run'ları sayar (per-turn değil) → maxChildRunsPerTurn erken tetiklenir. Fix: turn başına reset.

## LOW — 132 (özet, detay için kaynak raporlar)

- **Store/Stream:** run-stream.ts:1097 çift persist satırı (duplicate flush); update.ts:41 download single-flight yok; App.tsx:2094 codemap manual build race.
- **Tools:** fs.ts:190 CRLF `\r` sızıntısı; fs.ts:249 non-atomic write + TOCTOU; web.ts:426 `fc/fd/fe80` prefix false-positive IPv6 bloğu; file-watcher.ts:30 gitMetaTimer cleanup yok; file-watcher.ts:36 `dist/build/target/out` isimli dosyalar ignore; monitor.ts:6 regex catastrophic backtracking; notebook.ts:115 lock yok; index.ts:1434 formatter'lar hook-rewrite path'i almıyor; exec.ts:198 timeout kill fire-and-forget; patch.ts:280 no-op hunk sayımı; stdio-transport.ts:68 spawn timeout yok.
- **Permission/Plugins:** hooks.ts:29 hook trust id ile keylenmiş (fingerprint yok); fingerprint.ts:21 symlink target hash'lenmez; audit.ts:105 tam entry console.warn (secret sızabilir); legacy.ts:14 `"*"` append exact deny'i prefix'e çevirir; sandbox.ts:73 validateHookCommand regex bypass; marketplace.ts:164 manifestPath `..`/absolute containment yok.
- **Config/DB:** config/parse.ts:76 trailing-comma regex string içi bozar; memory-store/store.ts:49 scope validate yok; config/schema.ts:431 `theme` load'da clobber; sessions-db.ts:232 corrupt blob JSON.parse throw.
- **Providers:** cerebras.ts:16 `qwen-3-32b`→`qwen3-32b`; auth.ts:15 isConnectedSync unresolvable token'da "connected" der; error.ts:187 413→context_overflow yanlış sınıf; error.ts:78 auth pattern quota'yı "reconnect"e düşürür; error.ts:210 nested error field parse yok; azure.ts:29 deployment name mapping yok; client-versions.ts:32 registry fetch timeout yok; id.ts:30 modulo bias; mcp.ts:152 `/oauth/i` yanlış needsAuth; secret-store.ts:121 array `typeof h==="object"` kabulü.
- **Skills/Agents:** skills/parse.ts:21 empty name `""` dedup çakışması; agents/parse.ts:23 block scalar/bool/float mis-parse; agents-seed.ts:361 regex `\]` truncate; skills/frontmatter.ts:62 dotted keys + unindented list; sdd-trace.ts:47 `R-1x` false match; prompt-enhance.ts:18 stripFence trailing newline; small-model.ts:49 free model'lar cost path'ten elenir; skills/parse.ts:40 untrusted description system prompt'a injection; agents/parse.ts:191 bashDeny prefix chained command bypass.
- **Git/Orchestra:** pr-review-daemon.ts:67 corrupt localStorage → tüm PR'ları spam review; pr-uri/diff-uri/turn-diff-uri decodeURIComponent throw; git.ts:565 ref option injection; turn-edits.ts:75 line count +1; terminal-path-input.ts:4 Windows quote double; acp/connection.ts:103 spawn öncesi close orphan; diff.ts:17 büyük diff fallback tam dosyayı değişmiş gösterir; git-review.ts:153 ` b/` içeren path split.
- **Components:** CodeEditor.tsx:70 unmount cleanup stale path; AgentTaskCard.tsx:125 durum etiketi çift render; Composer.tsx:929 watcher unmount cleanup yok; Composer.tsx:1356 IME composition check yok; ContextPanel.tsx:162 resize listener cleanup yok; DiffViewer.tsx:33 staged state uri değişince resetlenmez; CodeView.tsx:80 trailing newline hayalet satır; DiffView.tsx:231 hardcoded EN; Dialog.tsx:69 focus trap kaçışı; CustomProviderModal.tsx:382 çift save; StoredImage.tsx:29 revoke stale; Sidebar.tsx:126 drag width ref; RoutinesOverlay.tsx:358 edit before load; useSddDocSync.ts:61 expectPreviewRef stale; SkillsTab.tsx:19 reload stale; ModelsPage.tsx:71 probe stale; TerminalCliIcon.tsx:44 gradient id çakışması; WindowsAppMenu.tsx:44 Escape yok.
- **Markdown/Preview:** MessageList.tsx:707 Bubble memo comparator eksik; Markdown.tsx:195 boundary permanent error; MermaidBlock.tsx:31 theme once; MarkdownWysiwyg.tsx:80 placeholder static; PRPanel.tsx:86 hardcoded TR toast; PluginInstallApproval.tsx:210 `.replace("{count}")` translated string; PreviewPanel.tsx:112 log reset yok; MessageList.tsx:790 copy setTimeout cleanup yok; PRPanel.tsx:687 TokenForm save try/catch yok; OutputViewer.tsx:10 no subscription; InlineEditBar.tsx:44 refocus edge.
- **Lib misc:** useNavHistory.ts:35 suppress stuck; workspace-roots.ts:24 case-sensitive merge; fs-browse.ts:48 dotfile case; file-invalidate.ts:21 `.git` case; rg-download.ts:14 no exec check + no `.exe`; file-clipboard.ts:83 cut fail clipboard temizler; output-doc.ts:16 insertion-order eviction; compact-output/detect.ts:19 `npm test` generic'e düşer; workspace-tree.ts:25 localeCompare locale'siz; wildcard.ts:22 `*`→`.*` `/` geçer; scroll-memory.ts:3 unbounded Map; theme-loader.ts:68 id collision; protected.ts:68 case-sensitive; useBootDraft.ts:13 her boot yeni draft; history-hygiene:52 TR marker; privacy/index.ts:65 wrong span replace.
- **Commands/Cron/Vim:** commands/parse.ts:55 escape check dead; parse.ts:81 escaped named placeholder; parse.ts:29 apostrophe strip; parse.ts:61 tab-arg; commands/index.ts:47 builtin override yok; routine-scheduler.ts:50 once+fireAt fire etmez; routine-scheduler.ts:162 wake miss; cron.ts:70 dom+dow AND; cron.ts:19 dow:7 reject; vim engine: 2J join, J empty line, cw space, b leading, t/T neighbor, text-object count, useVim.ts:40 desync; updater.ts:25 no re-entrancy; editor-save.ts:8 consumeSelfWrite mark silmez; tokens.ts:66 file part'ları sayılmaz; search.ts:134 grep-fallback glob dir prefix; replay.ts:26 + side-chat.ts:31 non-string content trim throw; suggestions.ts:79 trailing `]`; composer-drop.ts:27 random composer fallback; use-commit-review.tsx:95 reentrant gate hang; image.ts:76 no size budget; system-prompt.ts:291 MCP budget ilk server'ı aşar.
- **Rust:** exec.rs:255 tasklist substring PID; browser.rs:135 IPv4-compatible IPv6 bypass; code_map.rs:98 DefaultHasher sabit key; code_map.rs:1466 error'lar yutulur; pty.rs:388 rc-file symlink overwrite; code_map.rs:1087 per-command connection interleave.
- **Tests:** memory-store.test.ts:79 +200 token slack; agent-supervisor.test.ts:246 real sleep flaky; lock-serialize.test.ts:12 + workflow-semaphore.test.ts:13 fixed sleeps; routine-scheduler.test.ts:8 cron+mocked module.

---

## Takip notları

- Her fix: test yaz (önce fail), sonra fix, `npx eslint .` + `npx tsc --noEmit --ignoreDeprecations 5.0 -p tsconfig.app.json` + `npm test`.
- Commit: `fix: #H#` / `fix: #M#` etiketiyle.
- HIGH'lar öncelikli: H2 (pty deadlock), H3 (privacy), H4/H5 (plugin güvenlik), H9 (mcp-auth), H6-8 (provider CORS), H10 (approval ters aksiyon).
- Bu dosya silinmez — kapandıkça checkbox işaretle.
