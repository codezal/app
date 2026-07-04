
export const IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "tiff", "tif", "heic", "heif", "avif", "raw", "psd",
  "xcf", "ai", "eps",
])

export const BINARY_EXT = new Set([
  "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "node", "wasm",
  "zip", "tar", "gz", "bz2", "xz", "7z", "rar", "tgz",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "db", "sqlite", "sqlite3",
  // JVM
  "jar", "war", "ear", "class",
  "pyc", "pyd",
  // Ses
  "mp3", "wav", "ogg", "flac", "aac", "m4a",
  // Video
  "mp4", "avi", "mov", "mkv", "webm", "flv",
  // Font
  "ttf", "otf", "woff", "woff2", "eot",
  "iso", "dmg", "pkg", "deb", "rpm",
])

function ext(name: string): string {
  const i = name.lastIndexOf(".")
  return i === -1 ? "" : name.slice(i + 1).toLowerCase()
}

export function isImage(name: string): boolean {
  return IMAGE_EXT.has(ext(name))
}

export function isPdf(name: string): boolean {
  return ext(name) === "pdf"
}

export function isBinary(name: string): boolean {
  const e = ext(name)
  return BINARY_EXT.has(e) || IMAGE_EXT.has(e)
}

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  tif: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
}

export function mimeForImage(name: string): string {
  return MIME_MAP[ext(name)] ?? "image/octet-stream"
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
