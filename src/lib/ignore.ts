
export const IGNORE_DIRS = new Set([
  // VCS
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".vite",
  ".turbo",
  ".cache",
  // Dil spesifik
  "target",       // Rust / Maven
  "__pycache__",  // Python
  ".venv",        // Python venv
  "venv",         // Python venv (alternatif isim)
  "vendor",       // Go / PHP
  "coverage",
  // IDE
  ".idea",
  ".vscode",
  ".DS_Store",
  ".codezal",
])
