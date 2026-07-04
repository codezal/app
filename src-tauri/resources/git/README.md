# Bundled Git (Windows)

Windows derlemesi için **PortableGit** buraya açılır. Codezal'ın exec katmanı
(`src-tauri/src/exec.rs`) bu dizini Windows'ta PATH'in başına ekler → `git.exe`,
`bash.exe` ve coreutils (cp/rm/mkdir/printf) sistem kurulumu olmadan bulunur.
bash tool, hooks, MCP stdio launch ve plugin işlemleri bunlara bağlıdır.

## Kurulum (Windows build öncesi)

1. PortableGit indir:
   https://github.com/git-for-windows/git/releases
   → `PortableGit-<sürüm>-64-bit.7z.exe` (self-extracting).
2. Bu dizine (`src-tauri/resources/git/`) aç. Sonuç şu alt dizinleri içermeli:
   - `cmd/git.exe`
   - `usr/bin/bash.exe` + coreutils (cp.exe, rm.exe, mkdir.exe, …)
   - `mingw64/bin/`, `bin/`
3. (Opsiyonel, boyut için) `doc/`, `locale/`, `mingw64/share/` silinebilir → ~150MB.

## Notlar

- **Lisans:** Git for Windows GPLv2 — dağıtımda `LICENSE.txt`'i koru.
- **macOS/Linux:** Bu dizin yok sayılır (`exec.rs` bundled-git mantığı `#[cfg(windows)]`).
- Bu klasör boşsa (yalnız bu README) uygulama sistemdeki git'e fallback eder —
  build kırılmaz, sadece kullanıcının Git for Windows kurmuş olması gerekir.
- Gerçek PortableGit binary'leri repoya **commit edilmez** (büyük); CI/release
  adımında indirilip buraya açılmalı.
