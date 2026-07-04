// TCC: Transparency, Consent, Control — izin diyalogu tetiklenecek dizinler.
import { homeDir } from "@tauri-apps/api/path"

const DARWIN_HOME_NAMES = new Set([
  "Music", "Pictures", "Movies", "Downloads", "Desktop",
  "Documents", "Public", "Applications", "Library",
])

const DARWIN_LIBRARY_SUBDIRS = [
  "Application Support/AddressBook",
  "Calendars",
  "Mail",
  "Messages",
  "Safari",
  "Cookies",
  "TCC",
  "Metadata",
]

const DARWIN_ROOT_PATHS = [
  "/.DocumentRevisions-V100",
  "/.Spotlight-V100",
  "/.Trashes",
  "/.fseventsd",
]

const WIN32_HOME_NAMES = new Set([
  "AppData", "Downloads", "Desktop", "Documents",
  "Pictures", "Music", "Videos", "OneDrive",
])

function isDarwin(): boolean {
  return /Mac/i.test(navigator.userAgent)
}

function isWin(): boolean {
  return /Win/i.test(navigator.userAgent)
}

export function protectedNames(): Set<string> {
  if (isDarwin()) return DARWIN_HOME_NAMES
  if (isWin()) return WIN32_HOME_NAMES
  return new Set()
}

let _home: string | null = null
async function home(): Promise<string> {
  if (!_home) _home = (await homeDir()).replace(/[\\/]+$/, "")
  return _home
}

export async function protectedPaths(): Promise<string[]> {
  if (!isDarwin() && !isWin()) return []
  const h = await home()
  if (isDarwin()) {
    return [
      ...[...DARWIN_HOME_NAMES].map((n) => `${h}/${n}`),
      ...DARWIN_LIBRARY_SUBDIRS.map((s) => `${h}/Library/${s}`),
      ...DARWIN_ROOT_PATHS,
    ]
  }
  return [...WIN32_HOME_NAMES].map((n) => `${h}/${n}`)
}

export async function isProtected(absPath: string): Promise<boolean> {
  const guarded = await protectedPaths()
  const norm = absPath.replace(/[\\/]+$/, "")
  return guarded.some((p) => norm === p || norm.startsWith(p + "/"))
}
